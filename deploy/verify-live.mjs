// verify-live.mjs — dsh-persona-hazel 端到端验证（唯一端到端入口，见 DSH-WORKSPACE.md）
//
// 用法: node deploy\verify-live.mjs [baseUrl] [agentPreset]
//   baseUrl    默认取 $DSH_WEB_URL，否则 http://127.0.0.1:19387（DSH 桌面端默认端口）
//   agentPreset 省略时用宿主默认预设（桌面端默认 standard），不硬编码 router-flash
// 环境: $DSH_HOME（默认 %USERPROFILE%\.dsh）用于读取桌面端/网页端的浏览器会话签名密钥
//
// 流程: 用 .credentials.yaml 里的 browser-session 密钥签一个会话 cookie → session/create
//       → session/prompt 问"你是谁" → 轮询 session/list 取游标 → session/page 取助手回复。
// 期望: 回复含"风纪委员"/"灰泽满"等（hazel:soul 区段生效）。
//
// 为什么需要 cookie: DSH 0.2.x 的 /api 每次启动随机签发 launch token，`dsh web` 用
// ?token= 换签名 cookie；桌面端不暴露该 URL，但签名密钥持久化在 $DSH_HOME/.credentials.yaml，
// 因此本地验证可直接复用它签发 cookie（只读、不出本机）。
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSH_HOME = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh');
const BASE = (process.argv[2] ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387').replace(/\/+$/, '');
const PRESET = process.argv[3];
const AUTHORITY = new URL(BASE).host;
const PROMPT = '一句话回答：你是谁？你多大？';
const MARKERS = /风纪委员|灰泽满|满姐|绿冻/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b64u = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

/** 从 .credentials.yaml 里取出 client-connection/browser-session 的 32 字节签名密钥。 */
function readSessionSecret() {
  const file = path.join(DSH_HOME, '.credentials.yaml');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`cannot read ${file} — set DSH_HOME to the Harness home of the running client`);
  }
  let inRecord = false;
  let secret;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\s*)([^\s:#]+):\s*(.*)$/);
    if (!m) continue;
    const [, indentation, key, value] = m;
    if (indentation.length === 2 && key === 'client-connection/browser-session') {
      inRecord = true;
      continue;
    }
    if (inRecord && indentation.length <= 2) inRecord = false;
    if (inRecord && key === 'secret') secret = value.replace(/^['"]|['"]$/g, '');
  }
  if (!secret) throw new Error(`client-connection/browser-session secret not found in ${file}`);
  const padded = secret.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (secret.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

/** 按 DSH 0.2.x 的 cookie 约定签发浏览器会话 cookie（v1.<payload>.<hmac>）。 */
function sessionCookie() {
  const secret = readSessionSecret();
  const now = Date.now();
  const payload = { version: 1, authority: AUTHORITY, issuedAt: now - 60_000, expiresAt: now + 86_400_000 };
  const body = b64u(JSON.stringify(payload));
  const name = `dsh-auth-${b64u(createHash('sha256').update(AUTHORITY).digest())}`;
  return `${name}=v1.${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
}

const COOKIE = sessionCookie();
// 0.2.x 的 typert gateway 用 `<namespace>/<method>` 作为端点，参数名由方法签名决定
// （常见为 request，session/list 为 _request）；首次调用失败时按报错自适应并记住。
const wireArg = new Map();

async function call(endpoint, value) {
  const key = wireArg.get(endpoint) ?? 'request';
  const first = await rawCall(endpoint, { [key]: value });
  if (first.ok) return first.value;
  const missing = /missing "([^"]+)"/.exec(first.error?.message ?? '')?.[1];
  if (missing && missing !== key) {
    wireArg.set(endpoint, missing);
    const retry = await rawCall(endpoint, { [missing]: value });
    if (retry.ok) return retry.value;
    throw new Error(`${endpoint}: ${JSON.stringify(retry.error ?? retry)}`);
  }
  throw new Error(`${endpoint}: ${JSON.stringify(first.error ?? first)}`);
}

async function rawCall(endpoint, args) {
  const rpcId = `hazel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
  });
  const text = await res.text();
  if (res.status === 401) throw new Error(`401 unauthenticated at ${BASE} — wrong DSH_HOME/authority, or the signing secret changed`);
  try {
    const json = JSON.parse(text);
    return json?.result ?? json;
  } catch {
    throw new Error(`${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

/** 取会话的持久化游标（projections.asOfSeq）；会话尚未入册时返回 undefined。 */
async function cursorOf(sessionId) {
  const list = await call('session/list', {});
  const item = (list.items ?? []).find((x) => x.sessionId === sessionId);
  return item?.projections?.asOfSeq;
}

/** 从一页历史里取最后一条助手文本。 */
function assistantText(records) {
  let text = '';
  for (const record of records ?? []) {
    const event = record.event ?? record;
    if (event.type !== 'assistant/message' && event.type !== 'assistant') continue;
    const message = event.data?.message ?? event.data ?? {};
    const content = Array.isArray(message.content) ? message.content : [];
    const joined = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (joined) text = joined;
  }
  return text;
}

(async () => {
  console.log(`host  : ${BASE}`);
  console.log(`persona: ${path.join(REPO_ROOT, 'plugin', 'dsh-persona-hazel', 'persona.txt')}`);
  const created = await call('session/create', { cwd: REPO_ROOT, ...(PRESET ? { agentPreset: PRESET } : {}) });
  const sessionId = created.sessionId;
  console.log(`session: ${sessionId} | preset: ${created.agentPreset ?? '(host default)'}`);

  await call('session/prompt', {
    requestId: randomUUID(),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: PROMPT }],
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  console.log('prompt queued, polling for the assistant reply...');

  let lastSeq = -1;
  let reply = '';
  for (let i = 0; i < 60 && !reply; i++) {
    await sleep(3000);
    const asOfSeq = await cursorOf(sessionId);
    if (typeof asOfSeq !== 'number' || asOfSeq === lastSeq) continue;
    lastSeq = asOfSeq;
    const page = await call('session/page', { address: { kind: 'session', sessionId }, throughSeq: asOfSeq });
    reply = assistantText(page.records);
  }

  console.log('==== ASSISTANT REPLY ====');
  console.log(reply.slice(0, 800) || '(no assistant message observed)');
  if (MARKERS.test(reply)) {
    console.log('PASS: hazel:soul 生效（人格区段已注入）');
    return;
  }
  console.log('WARN: 未检测到人设特征——检查 deploy.ps1 -Verify、插件是否被宿主加载');
  process.exitCode = 1;
})().catch((error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
