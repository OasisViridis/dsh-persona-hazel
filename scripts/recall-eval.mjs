#!/usr/bin/env node
/**
 * recall-eval.mjs — 人格召回的确定性评测（不连 DSH，不联网，毫秒级）。
 *
 * 为什么要有它：召回是关键词 + 正则 + bigram 兜底拼出来的，改一个词、调一个
 * 阈值，是变好还是变坏，此前只能靠手感。这个脚本把「准不准」变成可回归的数字。
 *
 * 标注集 persona/recall/eval-set.json 每条：
 *   { "message": "用户消息", "expect": "场景id" | ["id1", "id2"] | [], "note": "可选" }
 *   - 字符串：top-1 必须命中它
 *   - 数组：这些场景都必须被召回（top-2 以内）
 *   - 空数组：不该命中任何场景（负例：干活消息、无关闲聊）
 *
 * 用法：
 *   node scripts/recall-eval.mjs              # 人类可读报告
 *   node scripts/recall-eval.mjs --json       # 机器可读（stdout 只有 JSON）
 *   node scripts/recall-eval.mjs --strict     # 任一条失败就退出码 1
 *   node scripts/recall-eval.mjs --verbose    # 逐条打印命中结果
 *
 * 指标：
 *   primary    top-1 是否命中期望场景
 *   coverage   期望的场景是否全部被召回
 *   negative   负例是否一个都没被召回
 *   fallback   有多少条走了 bigram 兜底（弱匹配，通常意味着没撞上关键词）
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRecall, renderRecall } from '../plugin/dsh-persona-hazel/recall.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECALL_DATA = path.join(REPO_ROOT, 'plugin', 'dsh-persona-hazel', 'recall-data.json');
const EVAL_SET = path.join(REPO_ROOT, 'persona', 'recall', 'eval-set.json');

const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');
const VERBOSE = process.argv.includes('--verbose');

const data = JSON.parse(readFileSync(RECALL_DATA, 'utf8'));
const set = JSON.parse(readFileSync(EVAL_SET, 'utf8'));
const maxScenes = Number.isFinite(set.maxScenes) ? set.maxScenes : 2;

/** 把一个 case 的期望归一成 { list, negative }。 */
function expectationOf(entry) {
  const raw = entry.expect;
  if (Array.isArray(raw)) return { list: raw.filter((id) => typeof id === 'string'), negative: raw.length === 0 };
  if (typeof raw === 'string' && raw.length > 0) return { list: [raw], negative: false };
  return { list: [], negative: true };
}

/** 跑一条 case，返回命中详情。 */
function runCase(entry) {
  const { list, negative } = expectationOf(entry);
  const selected = selectRecall(entry.message, data, { maxScenes });
  const ids = selected === null ? [] : selected.scenes.map((scene) => scene.scene?.id ?? null);
  const fallback = Boolean(selected?.fallback);
  const rendered = renderRecall(entry.message, data, { maxScenes });
  const chars = rendered.length;

  const primary = negative ? ids.length === 0 : ids[0] === list[0];
  const covered = list.filter((id) => ids.includes(id));
  const coverage = negative ? ids.length === 0 : covered.length === list.length;

  return {
    message: entry.message,
    note: entry.note ?? null,
    negative,
    expect: list,
    got: ids,
    fallback,
    chars,
    primary,
    coverage,
    ok: primary && coverage,
  };
}

const results = (set.cases ?? []).map(runCase);
const positives = results.filter((item) => !item.negative);
const negatives = results.filter((item) => item.negative);
const rate = (passed, total) => (total === 0 ? 1 : passed / total);
const pct = (value) => `${(value * 100).toFixed(1)}%`;

const primaryHit = positives.filter((item) => item.primary).length;
const coverageHit = positives.filter((item) => item.coverage).length;
const negativeClean = negatives.filter((item) => item.primary).length;
const fallbackUsed = results.filter((item) => item.fallback).length;
const avgChars = results.length === 0 ? 0 : Math.round(results.reduce((sum, item) => sum + item.chars, 0) / results.length);
const maxChars = results.reduce((best, item) => Math.max(best, item.chars), 0);
const failures = results.filter((item) => !item.ok);

/** 覆盖率：标注集实际碰到了多少个场景。 */
const coveredScenes = new Set();
for (const item of positives) for (const id of item.expect) coveredScenes.add(id);
const allScenes = new Set((data.scenes ?? []).map((scene) => scene.id));
const untouched = [...allScenes].filter((id) => !coveredScenes.has(id));

const summary = {
  cases: results.length,
  positive: positives.length,
  negative: negatives.length,
  primary: { passed: primaryHit, total: positives.length, rate: rate(primaryHit, positives.length) },
  coverage: { passed: coverageHit, total: positives.length, rate: rate(coverageHit, positives.length) },
  negativeClean: { passed: negativeClean, total: negatives.length, rate: rate(negativeClean, negatives.length) },
  fallback: { used: fallbackUsed, total: results.length },
  chars: { avg: avgChars, max: maxChars },
  scenes: { covered: coveredScenes.size, total: allScenes.size, untouched },
  failures: JSON.parse(JSON.stringify(failures)),
  results: JSON_OUT ? results : undefined,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const log = (line = '') => console.log(line);
  log(`cases      : ${summary.cases}（正例 ${summary.positive} / 负例 ${summary.negative}）`);
  log(`primary    : ${primaryHit}/${positives.length}  ${pct(summary.primary.rate)}  top-1 命中期望场景`);
  log(`coverage   : ${coverageHit}/${positives.length}  ${pct(summary.coverage.rate)}  期望场景全部召回`);
  log(`negative   : ${negativeClean}/${negatives.length}  ${pct(summary.negativeClean.rate)}  负例零误命中`);
  log(`fallback   : ${fallbackUsed}/${summary.cases}  走 bigram 兜底`);
  log(`chars      : 平均 ${avgChars} / 峰值 ${maxChars}（运行时预算 700）`);
  log(`scenes     : ${coveredScenes.size}/${allScenes.size} 被标注集覆盖`);
  if (untouched.length > 0) log(`untouched  : ${untouched.join(', ')}`);
  if (failures.length === 0) {
    log('\nno failures');
  } else {
    log(`\n${failures.length} 条未达预期：`);
    for (const item of failures) {
      const want = item.negative ? '(不该命中)' : item.expect.join('+');
      const got = item.got.length === 0 ? '(无)' : item.got.join('+');
      log(`  - "${item.message}"  期望 ${want}，实得 ${got}${item.note ? `  // ${item.note}` : ''}`);
    }
  }
  if (VERBOSE) {
    log('\n逐条：');
    for (const item of results) {
      const want = item.negative ? '(none)' : item.expect.join('+');
      const got = item.got.length === 0 ? '(none)' : item.got.join('+');
      log(`  ${item.ok ? 'ok  ' : 'FAIL'}  ${want.padEnd(16)} <- ${got.padEnd(16)} ${item.message}`);
    }
  }
}

if (STRICT && failures.length > 0) process.exitCode = 1;
