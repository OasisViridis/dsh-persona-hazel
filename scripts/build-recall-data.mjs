#!/usr/bin/env node
/**
 * build-recall-data.mjs — 把 persona/ 下的人格数据 + 召回场景表编译成
 * plugin/dsh-persona-hazel/recall-data.json（插件运行时自包含数据）。
 *
 * 用法：
 *   node scripts/build-recall-data.mjs            # 生成/覆盖 recall-data.json
 *   node scripts/build-recall-data.mjs --check    # 只校验已生成文件是否最新（不写）
 *   node scripts/build-recall-data.mjs --dry-run  # 打印统计，不写
 *
 * 铁律：scenes.json 只做「情境 → 已有素材」的映射；这里不改写任何样本原文。
 * 任何被引用的 id 不存在都会失败，避免运行时静默漏召回。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERSONA = join(ROOT, 'persona');
const SCENES_FILE = join(PERSONA, 'recall', 'scenes.json');
const OUT_FILE = join(ROOT, 'plugin', 'dsh-persona-hazel', 'recall-data.json');
const SAMPLE_FILE = join(PERSONA, 'speech', 'voice_samples.json');
const PHRASE_FILE = join(PERSONA, 'speech', 'phrases.json');
const BEHAVIOR_FILE = join(PERSONA, 'behavior', 'behaviors.json');
const TERM_FILE = join(PERSONA, 'world', 'terms.json');
const STORY_FILE = join(PERSONA, 'world', 'core_stories.json');
const PREF_FILE = join(PERSONA, 'world', 'preferences.json');

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : 'write';

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${file}: ${error.message}`);
  }
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail(`${name} must be an array of non-empty strings`);
  }
}

function main() {
  const scenesDoc = readJson(SCENES_FILE);
  const samplesDoc = readJson(SAMPLE_FILE);
  const phrasesDoc = readJson(PHRASE_FILE);
  const behaviorsDoc = readJson(BEHAVIOR_FILE);
  const termsDoc = readJson(TERM_FILE);
  const storiesDoc = readJson(STORY_FILE);
  const prefsDoc = readJson(PREF_FILE);

  if (!Array.isArray(scenesDoc.scenes) || scenesDoc.scenes.length === 0) fail('scenes.json has no scenes');
  const budget = scenesDoc.budgetChars ?? 700;
  if (!Number.isInteger(budget) || budget < 200 || budget > 2000) fail(`budgetChars must be an integer 200..2000, got ${budget}`);
  const fallbackThreshold = scenesDoc.fallbackThreshold ?? 0.16;
  if (typeof fallbackThreshold !== 'number' || fallbackThreshold < 0 || fallbackThreshold > 1) {
    fail(`fallbackThreshold must be a number 0..1, got ${fallbackThreshold}`);
  }

  const samples = new Map((samplesDoc.samples ?? []).map((sample) => [sample.id, sample]));
  const phrases = new Map((phrasesDoc.phrase_groups ?? []).map((group) => [group.id, group]));
  const behaviorList = Array.isArray(behaviorsDoc) ? behaviorsDoc : (behaviorsDoc.behaviors ?? []);
  const behaviors = new Map(behaviorList.map((behavior) => [behavior.name, behavior]));
  const terms = new Map((termsDoc.terms ?? []).map((term) => [term.keyword, term]));
  const storyList = (storiesDoc.stories ?? []).filter((story) => typeof story?.text === 'string' && story.text.length > 0);
  const stories = new Map(storyList.map((story) => [story.id, story]));
  const prefList = (prefsDoc.entries ?? []).filter((entry) => typeof entry?.text === 'string' && entry.text.length > 0);
  const preferences = new Map(prefList.map((entry) => [entry.id, entry]));

  const ids = new Set();
  const referenced = new Set();
  const normalized = [];
  for (const scene of scenesDoc.scenes) {
    if (!scene || typeof scene !== 'object') fail('every scene must be an object');
    if (typeof scene.id !== 'string' || scene.id.length === 0) fail('every scene needs a string id');
    if (ids.has(scene.id)) fail(`duplicate scene id "${scene.id}"`);
    ids.add(scene.id);
    if (typeof scene.label !== 'string' || scene.label.length === 0) fail(`scene "${scene.id}" needs a label`);
    if (!Number.isInteger(scene.priority ?? 0)) fail(`scene "${scene.id}" priority must be an integer`);
    assertStringArray(scene.keywords ?? [], `scene "${scene.id}" keywords`);
    assertStringArray(scene.patterns ?? [], `scene "${scene.id}" patterns`);
    for (const pattern of scene.patterns ?? []) {
      try {
        new RegExp(pattern);
      } catch (error) {
        fail(`scene "${scene.id}" has an invalid pattern ${JSON.stringify(pattern)}: ${error.message}`);
      }
    }
    assertStringArray(scene.samples ?? [], `scene "${scene.id}" samples`);
    for (const id of scene.samples ?? []) {
      const sample = samples.get(id);
      if (!sample) fail(`scene "${scene.id}" references unknown sample "${id}"`);
      referenced.add(id);
      if (typeof sample.user !== 'string' || typeof sample.reply !== 'string') {
        fail(`sample "${id}" needs user and reply strings`);
      }
    }
    if (scene.phraseGroup != null && !phrases.has(scene.phraseGroup)) {
      fail(`scene "${scene.id}" references unknown phrase group "${scene.phraseGroup}"`);
    }
    if (scene.behavior != null && !behaviors.has(scene.behavior)) {
      fail(`scene "${scene.id}" references unknown behavior "${scene.behavior}"`);
    }
    assertStringArray(scene.terms ?? [], `scene "${scene.id}" terms`);
    for (const keyword of scene.terms ?? []) {
      if (!terms.has(keyword)) fail(`scene "${scene.id}" references unknown term "${keyword}"`);
    }
    assertStringArray(scene.stories ?? [], `scene "${scene.id}" stories`);
    for (const id of scene.stories ?? []) {
      if (!stories.has(id)) fail(`scene "${scene.id}" references unknown story "${id}"`);
    }
    assertStringArray(scene.preferences ?? [], `scene "${scene.id}" preferences`);
    for (const id of scene.preferences ?? []) {
      if (!preferences.has(id)) fail(`scene "${scene.id}" references unknown preference "${id}"`);
    }
    if (scene.note != null && (typeof scene.note !== 'string' || scene.note.length > 120)) {
      fail(`scene "${scene.id}" note must be a string of at most 120 characters`);
    }
    normalized.push({
      id: scene.id,
      label: scene.label,
      priority: scene.priority ?? 0,
      keywords: scene.keywords ?? [],
      patterns: scene.patterns ?? [],
      samples: scene.samples ?? [],
      phraseGroup: scene.phraseGroup ?? null,
      behavior: scene.behavior ?? null,
      terms: scene.terms ?? [],
      stories: scene.stories ?? [],
      preferences: scene.preferences ?? [],
      note: scene.note ?? null,
    });
  }

  const usedPhrases = new Set(normalized.map((scene) => scene.phraseGroup).filter(Boolean));
  const usedBehaviors = new Set(normalized.map((scene) => scene.behavior).filter(Boolean));
  const usedTerms = new Set(normalized.flatMap((scene) => scene.terms));
  const usedStories = new Set(normalized.flatMap((scene) => scene.stories));
  const usedPreferences = new Set(normalized.flatMap((scene) => scene.preferences));

  const data = {
    _readme:
      '由 scripts/build-recall-data.mjs 从 persona/（scenes/voice_samples/phrases/behaviors/terms/core_stories/preferences）生成；不要手改，改源数据后重跑脚本。',
    budgetChars: budget,
    fallbackThreshold,
    scenes: normalized,
    samples: Object.fromEntries(
      (samplesDoc.samples ?? []).map((sample) => [
        sample.id,
        { id: sample.id, type: sample.type ?? 'daily', length: sample.length ?? 'short', user: sample.user, reply: sample.reply },
      ]),
    ),
    phrases: Object.fromEntries(
      (phrasesDoc.phrase_groups ?? [])
        .filter((group) => usedPhrases.has(group.id))
        .map((group) => [
          group.id,
          { id: group.id, meaning: group.meaning, trigger: group.trigger, phrases: group.phrases, usage: group.usage ?? '' },
        ]),
    ),
    behaviors: Object.fromEntries(
      behaviorList
        .filter((behavior) => usedBehaviors.has(behavior.name))
        .map((behavior) => [behavior.name, { name: behavior.name, trigger: behavior.trigger, response: behavior.response }]),
    ),
    terms: Object.fromEntries(
      (termsDoc.terms ?? [])
        .filter((term) => usedTerms.has(term.keyword))
        .map((term) => [term.keyword, { keyword: term.keyword, meaning: term.meaning, reaction: term.reaction ?? null }]),
    ),
    stories: Object.fromEntries(
      storyList
        .filter((story) => usedStories.has(story.id))
        .map((story) => [story.id, { id: story.id, category: story.category ?? '', text: story.text }]),
    ),
    preferences: Object.fromEntries(
      prefList
        .filter((entry) => usedPreferences.has(entry.id))
        .map((entry) => [entry.id, { id: entry.id, category: entry.category ?? '', text: entry.text }]),
    ),
  };

  const coverage = samples.size === 0 ? 0 : referenced.size / samples.size;
  if (referenced.size !== samples.size) {
    fail(`voice sample coverage ${referenced.size}/${samples.size}: every sample must be referenced by at least one scene`);
  }
  const text = `${JSON.stringify(data, null, 2)}\n`;

  console.log(`scenes            : ${normalized.length}`);
  console.log(`voice samples     : ${referenced.size}/${samples.size} referenced (${Math.round(coverage * 100)}%)`);
  console.log(`phrase groups     : ${usedPhrases.size}`);
  console.log(`behaviors         : ${usedBehaviors.size}`);
  console.log(`terms             : ${usedTerms.size}`);
  console.log(`stories           : ${usedStories.size}`);
  console.log(`preferences       : ${usedPreferences.size}`);
  console.log(`budgetChars       : ${budget}`);
  console.log(`output            : ${OUT_FILE}`);

  const existing = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : null;
  if (existing === text) {
    console.log('status            : up to date');
    return;
  }
  if (mode === 'check') {
    fail('recall-data.json is out of date; run `node scripts/build-recall-data.mjs` and commit the result');
  }
  if (mode === 'dry-run') {
    console.log('status            : would update (dry run)');
    return;
  }
  writeFileSync(OUT_FILE, text, 'utf8');
  console.log('status            : written');
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
