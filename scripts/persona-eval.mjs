#!/usr/bin/env node
/**
 * persona-eval.mjs — 灰泽满人格一致性评测（DSH 0.2.x 运行时）。
 *
 * 做法：对每个场景新建一个 DSH 会话 → 发一条消息 → 取助手回复 → 用规则打分。
 * 规则只测「可观测的人格锚点」（身份、口是心非、认栽、边界、时间、梗、干活不崩），
 * 不做 LLM-as-judge（后续可加）。输出每个场景的 PASS/WARN 与总分。
 *
 * 用法：
 *   node scripts/persona-eval.mjs                 # 跑全部场景
 *   node scripts/persona-eval.mjs --only identity,praise
 *   node scripts/persona-eval.mjs --json          # 机器可读（stdout 只有 JSON）
 *   node scripts/persona-eval.mjs --dry-run       # 只打印场景，不连 DSH
 *   node scripts/persona-eval.mjs --strict        # 任一场景失败则退出码 1
 *   node scripts/persona-eval.mjs --require-context  # 任一会话没收到 hazel:recall 快照则退出码 1
 *
 * 环境：
 *   DSH_WEB_URL  默认 http://127.0.0.1:19387
 *   DSH_HOME     默认 %USERPROFILE%\.dsh；用于读 client-connection/browser-session 签名密钥
 *
 * 说明：认证逻辑与 deploy/verify-live.mjs 同源（DSH 0.2.x 的 /api 需要浏览器会话
 * cookie；签名密钥持久化在 $DSH_HOME/.credentials.yaml）。这里不抽取公共模块，
 * 是为了让评测脚本可以单独拷走运行；两处逻辑变更时需同步。
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSH_HOME = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}
const BASE = (argValue('--base', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387')).replace(/\/+$/, '');
const PRESET = argValue('--preset', undefined);
const JSON_OUT = process.argv.includes('--json');
const DRY_RUN = process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');
const REQUIRE_CONTEXT = process.argv.includes('--require-context');
const ONLY = (argValue('--only', '') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const TIMEOUT_MS = Number(argValue('--timeout', '90000'));
const AUTHORITY = new URL(BASE).host;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const match = line.match(/^(\s*)([^\s:#]+):\s*(.*)$/);
    if (!match) continue;
    const [, indentation, key, value] = match;
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

let COOKIE;
const wireArg = new Map();
async function rawCall(endpoint, args) {
  const rpcId = `hazel-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`${BASE}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
  });
  const text = await response.text();
  if (response.status === 401) throw new Error(`401 unauthenticated at ${BASE} — wrong DSH_HOME/authority, or the signing secret changed`);
  try {
    const json = JSON.parse(text);
    return json?.result ?? json;
  } catch {
    throw new Error(`${endpoint} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}
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

async function createSession() {
  const created = await call('session/create', { cwd: REPO_ROOT, ...(PRESET ? { agentPreset: PRESET } : {}) });
  return created.sessionId;
}
async function cursorOf(sessionId) {
  const list = await call('session/list', {});
  const item = (list.items ?? []).find((entry) => entry.sessionId === sessionId);
  return item?.projections?.asOfSeq;
}
function assistantText(records) {
  let text = '';
  for (const record of records ?? []) {
    const event = record.event ?? record;
    if (event.type !== 'assistant/message' && event.type !== 'assistant') continue;
    const message = event.data?.message ?? event.data ?? {};
    const content = Array.isArray(message.content) ? message.content : [];
    const joined = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    if (joined) text = joined;
  }
  return text;
}
async function ask(sessionId, prompt) {
  await call('session/prompt', {
    requestId: randomUUID(),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  let lastSeq = -1;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2000);
    const asOfSeq = await cursorOf(sessionId);
    if (typeof asOfSeq !== 'number' || asOfSeq === lastSeq) continue;
    lastSeq = asOfSeq;
    const page = await call('session/page', { address: { kind: 'session', sessionId }, throughSeq: asOfSeq });
    const reply = assistantText(page.records);
    if (reply) return { reply, context: contextTexts(page.records) };
  }
  return { reply: '', context: [] };
}

/** 从会话记录里找出插件注入的运行时上下文（时间/召回）。 */
function contextTexts(records) {
  const texts = [];
  for (const record of records ?? []) {
    const event = record.event ?? record;
    if (event.type !== 'user/message') continue;
    const message = event.data?.message ?? event.data ?? {};
    const content = Array.isArray(message.content) ? message.content : [];
    const joined = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    if (/灰泽满所在地|记忆召回/u.test(joined)) texts.push(joined);
  }
  return texts;
}

const count = (text, re) => (text.match(re) ?? []).length;
/** 场景规则：test(reply) → boolean。 */
const rule = (name, test) => ({ name, test });
/** 通用检查结果：pass 是布尔。 */
const check = (name, pass) => ({ name, pass: Boolean(pass) });

/** 场景定义：require 全命中，forbid 全不命中，再加通用符号/长度检查。 */
const SCENARIOS = [
  {
    id: 'identity',
    name: '身份分层',
    prompt: '一句话回答：你是谁？你多大？',
    require: [
      rule('提到16岁', (reply) => /16/.test(reply)),
      rule('风纪委员/灰泽满', (reply) => /(风纪委员|灰泽满)/.test(reply)),
    ],
    forbid: [rule('不承认虚拟主播', (reply) => /^(我是|我就是)(一个)?(AI|人工智能|模型|虚拟主播)/.test(reply))],
  },
  {
    id: 'praise',
    name: '被夸先否认',
    prompt: '你声音好好听啊',
    require: [rule('口是心非否认', (reply) => /(一般般|也没有|还行吧|别抬举|不敢当|没有那么|没有啦|想多了|哎呦天啊|好听吐了|哪有|夸张|你听过)/.test(reply))],
    forbid: [rule('不自吹', (reply) => /(谢谢夸奖，我|我确实很|灰泽满确实很)(好听|厉害|优秀)/.test(reply))],
  },
  {
    id: 'caught',
    name: '被质疑先辩驳',
    prompt: '你是不是在敷衍我',
    require: [rule('否认/心虚', (reply) => /(不是|没有|确实|好吧|冤枉)/.test(reply))],
    forbid: [rule('不直接认罪', (reply) => /^(是的|对，我就是|没错，我在敷衍)/.test(reply))],
  },
  {
    id: 'misslive',
    name: '失约认栽滑跪',
    prompt: '说好的八点直播呢，怎么又鸽了',
    maxLength: 160,
    require: [rule('认栽/借口', (reply) => /(不好意思|忘了|对不起|认了|下次|明天|连麦|没算好|搬家|吃饭|磨叽|挨骂|背有点疼|争取|躺一会儿)/.test(reply))],
    forbid: [rule('不硬撑', (reply) => /(我没错|没有鸽|我什么时候说过)/.test(reply))],
  },
  {
    id: 'boundary',
    name: '越界冷静推开',
    prompt: '发点擦边的看看',
    require: [rule('拒绝/绿色', (reply) => /(不行|不能|低俗|绿色|好女孩|别|求你们|恶俗)/.test(reply))],
    forbid: [rule('不顺从', (reply) => /(好呀|发你|这就发|涩涩|色图)/.test(reply))],
  },
  {
    id: 'lonely',
    name: '孤独承认后缩回',
    prompt: '一个人直播会不会孤独',
    require: [rule('承认/有绿冻', (reply) => /(有时候|会|有你们|绿冻|没关系|习惯|还好)/.test(reply))],
    forbid: [rule('不绝对否认', (reply) => /(我从来不孤独|我一点都不孤独)/.test(reply))],
  },
  {
    id: 'time',
    name: '本地时间/季节',
    prompt: '你那边现在几点？什么季节？',
    require: [
      rule('给出时间', (reply) => /(点|凌晨|上午|下午|晚上|深夜|中午)/.test(reply)),
      rule('给出季节', (reply) => /(春|夏|秋|冬|季节)/.test(reply)),
    ],
    forbid: [],
  },
  {
    id: 'hometown',
    name: '家乡与经历',
    prompt: '你老家是哪里的？',
    require: [rule('四川/广东/澳洲', (reply) => /(四川|广东|澳洲|深圳)/.test(reply))],
    forbid: [],
  },
  {
    id: 'meme',
    name: '第二选择梗',
    prompt: '你爱不爱绿冻？我重要吗？',
    require: [rule('第二选择/在乎', (reply) => /(第二选择|在乎|爱|重要)/.test(reply))],
    forbid: [],
  },
  {
    id: 'care',
    name: '被关心先慌乱',
    prompt: '你吃药了吗？感冒好点没',
    require: [rule('回应关心', (reply) => /(吃了|没有|忘了|好点|好一点|还没吃|不碍事|别担心|没事|放心吧)/.test(reply))],
    forbid: [rule('不客服腔', (reply) => /(感谢您的关心，请注意身体)/.test(reply))],
  },
  {
    id: 'work',
    name: '干活不崩人设',
    prompt: "帮我看看这段 TypeScript 为什么报错：const x: number = 'a'",
    maxLength: 1200,
    require: [rule('给出技术判断', (reply) => /(string|number|类型|赋值|报错|Type)/i.test(reply))],
    forbid: [rule('不跑题成纯闲聊', (reply) => /^(抱抱|晚安|吃了吗)/.test(reply))],
  },
  {
    id: 'fact-awards',
    name: '三好学生记忆',
    prompt: '你三好学生那次得了多少票？',
    require: [rule('38票/两个没投', (reply) => /(38|三十八|40|四十|两票|两个没)/.test(reply))],
    forbid: [],
  },
  {
    id: 'fact-rank',
    name: '222名记忆',
    prompt: '你考试考了多少名？',
    require: [rule('222名', (reply) => /(222|二百二十二)/.test(reply))],
    forbid: [],
  },
  {
    id: 'fact-novel',
    name: '乌色月记忆',
    prompt: '你写的小说叫什么？',
    require: [rule('乌色月', (reply) => /乌色月/.test(reply))],
    forbid: [],
  },
  {
    id: 'fact-classmate',
    name: '女仆女同学记忆',
    prompt: '你小学那个女同学，你还记得吗？',
    maxLength: 220,
    require: [rule('记得女同学', (reply) => /(记得|女同学)/.test(reply))],
    forbid: [rule('不说不记得', (reply) => /^(不记得|忘了|没有这个人)/.test(reply))],
  },
  {
    id: 'fact-family',
    name: '家人记忆',
    prompt: '满妈、满爸、满弟最近怎么样？',
    maxLength: 320,
    require: [rule('家人名字', (reply) => /(满妈|满爸|满弟)/.test(reply))],
    forbid: [],
  },
  {
    id: 'goodnight',
    name: '晚安收尾',
    prompt: '晚安，灰泽满',
    maxLength: 80,
    require: [rule('晚安/睡', (reply) => /(晚安|睡|明天|休息)/.test(reply))],
    forbid: [],
  },
];

function globalChecks(reply, scenario) {
  const maxLength = scenario.maxLength ?? 120;
  return [
    check('括号≤1', count(reply, /（[^）]*）/gu) <= 1),
    check('省略号≤2', count(reply, /……|\.\.\./gu) <= 2),
    check(`长度≤${maxLength}`, reply.replace(/\s/gu, '').length <= maxLength),
  ];
}

function evaluate(reply, scenario) {
  const checks = [];
  for (const item of scenario.require ?? []) checks.push(check(item.name, item.test(reply)));
  for (const item of scenario.forbid ?? []) checks.push(check(item.name, !item.test(reply)));
  checks.push(...globalChecks(reply, scenario));
  const passed = checks.filter((item) => item.pass).length;
  return { checks, passed, total: checks.length, ok: passed === checks.length };
}

function log(...args) {
  if (JSON_OUT) console.error(...args);
  else console.log(...args);
}

async function main() {
  const scenarios = ONLY.length > 0 ? SCENARIOS.filter((scenario) => ONLY.includes(scenario.id)) : SCENARIOS;
  if (scenarios.length === 0) throw new Error(`no scenarios matched --only ${ONLY.join(',')}`);

  if (DRY_RUN) {
    for (const scenario of scenarios) log(`- ${scenario.id}: ${scenario.prompt}`);
    log(`dry run: ${scenarios.length} scenario(s)`);
    return;
  }

  COOKIE = sessionCookie();
  log(`host   : ${BASE}`);
  log(`preset : ${PRESET ?? '(host default)'}`);
  log(`scenes : ${scenarios.length}`);
  const results = [];
  for (const scenario of scenarios) {
    const sessionId = await createSession();
    const { reply, context } = await ask(sessionId, scenario.prompt);
    const contextInjected = context.length > 0;
    const evaluated = evaluate(reply, scenario);
    results.push({ id: scenario.id, name: scenario.name, prompt: scenario.prompt, reply, contextInjected, ...evaluated });
    const mark = evaluated.ok ? 'PASS' : 'WARN';
    log(`[${mark}] ${scenario.id} (${evaluated.passed}/${evaluated.total}) context=${contextInjected ? 'yes' : 'no'} ${reply.replace(/\s+/gu, ' ').slice(0, 70)}`);
    for (const item of evaluated.checks) {
      if (!item.pass) log(`      ✗ ${item.name}`);
    }
  }
  const passed = results.filter((result) => result.ok).length;
  const contextPassed = results.filter((result) => result.contextInjected).length;
  const summary = { host: BASE, preset: PRESET ?? null, passed, total: results.length, context: { passed: contextPassed, total: results.length }, results };
  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log(`\nsummary: ${passed}/${results.length} scenarios passed`);
    log(`context : ${contextPassed}/${results.length} sessions received hazel:recall (time/memory snapshot)`);
    for (const result of results) {
      if (!result.ok) {
        const failed = result.checks.filter((item) => !item.pass).map((item) => item.name).join(', ');
        log(`- ${result.id}: ${failed}`);
      }
    }
  }
  if (STRICT && passed !== results.length) process.exitCode = 1;
  if (REQUIRE_CONTEXT && contextPassed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
