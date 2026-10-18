#!/usr/bin/env node
/**
 * cross-surface-check.mjs — 跨端人格一致性检查（部署层）。
 *
 * 同一份 `persona/soul-card.md` 现在有两个消费者：
 *   1. DSH 插件 `dsh-persona-hazel` 的 `persona.txt`（`hazel:soul` 系统区段）
 *   2. Windows Codex 的 `model_instructions_file`（keysmith 部署）
 *
 * 两边只要有一个没跟上，就出现「同一个人格、不同版本」的漂移。这个脚本比对
 * 三份文本的 sha256：源卡、DSH 副本、Codex 指令文件。
 *
 * 用法：
 *   node scripts/cross-surface-check.mjs           # 人类可读报告
 *   node scripts/cross-surface-check.mjs --json    # 机器可读
 *   node scripts/cross-surface-check.mjs --strict  # 有任何漂移（含 Codex 未部署）退出码 1
 *
 * 环境：
 *   CODEX_HOME  默认 %USERPROFILE%\.codex
 *
 * 注意：Codex 侧缺配置时默认只报 MISSING，不算失败——CI 里没有 Codex 也更没有
 * 这份配置。需要强制校验时加 `--strict`。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUL_CARD = path.join(REPO_ROOT, 'persona', 'soul-card.md');
const DSH_COPY = path.join(REPO_ROOT, 'plugin', 'dsh-persona-hazel', 'persona.txt');
const CODEX_HOME = process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex');
const CODEX_CONFIG = path.join(CODEX_HOME, 'config.toml');

const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const short = (hash) => hash.slice(0, 12);
const bytes = (text) => Buffer.byteLength(text, 'utf8');

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 从 Codex config.toml 里抠出 model_instructions_file（双引号或单引号）。 */
function instructionPathFrom(configText) {
  if (!configText) return null;
  const doubleQuoted = /^\s*model_instructions_file\s*=\s*"([^"]+)"/mu.exec(configText);
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = /^\s*model_instructions_file\s*=\s*'([^']+)'/mu.exec(configText);
  if (singleQuoted) return singleQuoted[1];
  return null;
}

/** 把配置里的路径展开成绝对路径（支持 ~ 与相对路径）。 */
function expandPath(value, base) {
  let out = value.trim();
  if (out.startsWith('~')) out = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', out.slice(1));
  return path.isAbsolute(out) ? out : path.resolve(base, out);
}

const soulText = readText(SOUL_CARD);
if (soulText === null) {
  console.error(`FAIL: cannot read ${SOUL_CARD}`);
  process.exit(2);
}
const soulHash = sha256(soulText);

const dshText = readText(DSH_COPY);
const dsh = dshText === null
  ? { state: 'MISSING', path: DSH_COPY }
  : { state: sha256(dshText) === soulHash ? 'MATCH' : 'DRIFT', path: DSH_COPY, bytes: bytes(dshText), sha: short(sha256(dshText)) };

const configText = readText(CODEX_CONFIG);
const configured = instructionPathFrom(configText);
let codex;
if (configText === null) {
  codex = { state: 'MISSING', detail: `no config at ${CODEX_CONFIG}` };
} else if (!configured) {
  codex = { state: 'MISSING', detail: 'config.toml 没有 model_instructions_file（keysmith 未部署或被卸载）', config: CODEX_CONFIG };
} else {
  const resolved = expandPath(configured, CODEX_HOME);
  const codexText = readText(resolved);
  codex = codexText === null
    ? { state: 'MISSING', detail: `model_instructions_file 指向的文件不存在：${resolved}`, config: CODEX_CONFIG }
    : {
        state: sha256(codexText) === soulHash ? 'MATCH' : 'DRIFT',
        path: resolved,
        bytes: bytes(codexText),
        sha: short(sha256(codexText)),
      };
}

const drifts = [dsh, codex].filter((surface) => surface.state !== 'MATCH');
const summary = {
  soulCard: { path: SOUL_CARD, bytes: bytes(soulText), sha: short(soulHash) },
  dsh,
  codex,
  ok: drifts.length === 0,
  driftCount: drifts.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const log = (line) => console.log(line);
  log(`soul-card : ${bytes(soulText)} 字节  sha256 ${short(soulHash)}  ${path.relative(REPO_ROOT, SOUL_CARD)}`);
  log(`dsh       : ${dsh.state}${dsh.bytes ? `  ${dsh.bytes} 字节  sha256 ${dsh.sha}` : ''}  plugin/dsh-persona-hazel/persona.txt`);
  if (codex.state === 'MISSING') {
    log(`codex     : MISSING  ${codex.detail}`);
  } else {
    log(`codex     : ${codex.state}  ${codex.bytes} 字节  sha256 ${codex.sha}  ${codex.path}`);
  }
  if (summary.ok) {
    log('\n两端口径一致');
  } else {
    log(`\n${summary.driftCount} 处不一致：`);
    if (dsh.state !== 'MATCH') log('- DSH 副本与源卡不同步（跑 .\\deploy.ps1）');
    if (codex.state === 'MISSING') log('- Codex 侧未部署人格指令（跑 scripts\\deploy-codex.ps1 -Yes，或按文档回滚）');
    if (codex.state === 'DRIFT') log('- Codex 指令文件与源卡不同步（重新部署）');
  }
}

if (STRICT && !summary.ok) process.exitCode = 1;
