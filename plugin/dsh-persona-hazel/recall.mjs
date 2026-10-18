/**
 * recall.mjs — dsh-persona-hazel 的纯召回逻辑（不依赖 DSH / Node IO，可单测）。
 *
 * 输入是 persona/recall/scenes.json + 由 build-recall-data.mjs 生成的
 * recall-data.json；输出是一段「记忆召回」运行时上下文文本。
 * 设计原则：确定性、可解释、预算可控；不调用 embedding，不联网。
 */

const HEADER = '【灰泽满的记忆召回】下面是她真实说过的类似情境，只用来校准语气，不要照抄原句。';

/** 统一小写、去掉空白，用于关键词包含判断（保留中文标点不影响匹配）。 */
export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/gu, '');
}

/** 两个字符 bigram 集合；用于无场景命中时的兜底相似度。 */
export function bigrams(text) {
  const clean = normalize(text).replace(/[，。！？、,.!?：:；;（）()「」『』"'"'…—-]/gu, '');
  const set = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2));
  return set;
}

/** 对称 bigram 余弦相似度（0..1）。 */
export function similarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return overlap / Math.sqrt(a.size * b.size);
}

/** 单个场景的分数：关键词每个 +3，正则命中 +2。 */
export function scoreScene(message, scene) {
  const text = normalize(message);
  let score = 0;
  for (const keyword of scene.keywords ?? []) {
    const needle = normalize(keyword);
    if (needle.length > 0 && text.includes(needle)) score += 3;
  }
  for (const pattern of scene.patterns ?? []) {
    try {
      if (new RegExp(pattern, 'iu').test(message)) score += 2;
    } catch {
      // build-recall-data.mjs 已校验正则；运行时忽略坏 pattern。
    }
  }
  return score;
}

/** 默认召回几个场景：一句里常混两个意图，只取一个会让第二个意图裸奔。 */
export const DEFAULT_MAX_SCENES = 2;
/** 上限：再多就不是召回，而是整卡注入。 */
const MAX_SCENES_LIMIT = 3;
/**
 * 第二名的准入线：分数不得低于主场景本身，且至少够到两个信号（两个关键词，
 * 或一个关键词加一正则，即 ≥4）。
 *
 * 实测（28 场景 / 真实消息）放宽到「主场景一半」时，第二名几乎全是词面巧合：
 * 「你是虚拟主播吗」带出 peer（撞「主播」）、「说好的八点直播呢」带出 caught
 * （撞「说好的」）、「你声音好好听啊」带出 music（撞「好听」）。收紧后只有真
 * 双意图能进——「记得吃饭」= care 6 + food 6、「你声音好好听啊，今晚还直播
 * 吗」= praise 5 + misslive 5。
 */
const SECOND_SCENE_MIN_SCORE = 4;

/** 把场景数量夹到 1..MAX_SCENES_LIMIT。 */
function clampSceneCount(value) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_SCENES;
  return Math.min(MAX_SCENES_LIMIT, Math.max(1, Math.round(value)));
}

/**
 * 选出与当前消息最相关的场景（默认最多两个）；无命中时用 bigram 兜底。
 *
 * @returns {{scenes: Array<{scene: object|null, samples: object[], score: number}>, fallback: boolean, score: number}|null}
 *   `scenes` 按相关度降序；兜底命中时只有一项且 `scene` 为 `null`。
 */
export function selectRecall(message, data, options = {}) {
  const text = String(message ?? '').trim();
  if (text.length === 0) return null;
  const maxScenes = clampSceneCount(options.maxScenes);
  const ranked = (data.scenes ?? [])
    .map((scene) => ({ scene, score: scoreScene(text, scene) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || (right.scene.priority ?? 0) - (left.scene.priority ?? 0));
  if (ranked.length > 0) {
    const picked = [ranked[0]];
    if (maxScenes > 1) {
      const floor = Math.max(SECOND_SCENE_MIN_SCORE, ranked[0].score);
      // ranked 已按分数降序，遇到第一个不达标的就可以停。
      for (const entry of ranked.slice(1)) {
        if (picked.length >= maxScenes || entry.score < floor) break;
        picked.push(entry);
      }
    }
    return {
      scenes: picked.map(({ scene, score }) => ({
        scene,
        score,
        samples: (scene.samples ?? []).map((id) => data.samples?.[id]).filter(Boolean),
      })),
      fallback: false,
      score: ranked[0].score,
    };
  }

  let best = null;
  for (const sample of Object.values(data.samples ?? {})) {
    if (typeof sample?.user !== 'string') continue;
    const value = similarity(text, sample.user);
    if (!best || value > best.value) best = { sample, value };
  }
  const threshold = data.fallbackThreshold ?? 0.16;
  if (best && best.value >= threshold) {
    return {
      scenes: [{ scene: null, samples: [best.sample], score: best.value }],
      fallback: true,
      score: best.value,
    };
  }
  return null;
}

function clip(text, limit) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
}

/** 按句号/分号/感叹号切句，尽量在句子边界截断（避免故事/偏好被拦腰截断）。 */
function clipSentences(text, limit) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  const sentences = value.split(/(?<=[。；！？])/u);
  let out = '';
  for (const sentence of sentences) {
    if (out.length + sentence.length > limit) break;
    out += sentence;
  }
  return out || `${value.slice(0, Math.max(1, limit - 1))}…`;
}

/**
 * 一个场景贡献的正文行（不含 HEADER）。
 * @param {{scene: object|null, samples: object[]}} entry
 * @param {object} data
 */
function sceneLines(entry, data) {
  const lines = [];
  const { scene } = entry;
  if (scene === null) {
    const sample = entry.samples[0];
    if (sample) lines.push(`- 她说过类似的话：对方「${clip(sample.user, 60)}」→ 她「${clip(sample.reply, 120)}」`);
    return lines;
  }
  lines.push(`情境：${scene.label}`);
  for (const sample of entry.samples.slice(0, 2)) {
    lines.push(`- 对方「${clip(sample.user, 60)}」→ 她「${clip(sample.reply, 120)}」`);
  }
  if (scene.note) lines.push(`提示：${clip(scene.note, 90)}`);
  for (const id of (scene.stories ?? []).slice(0, 2)) {
    const story = data.stories?.[id];
    if (story) lines.push(`她记得（${clip(story.category, 12) || '记忆'}）：${clipSentences(story.text, 140)}`);
  }
  for (const id of (scene.preferences ?? []).slice(0, 3)) {
    const pref = data.preferences?.[id];
    if (pref) lines.push(`偏好（${clip(pref.category, 12) || '喜好'}）：${clipSentences(pref.text, 70)}`);
  }
  const phraseGroup = scene.phraseGroup ? data.phrases?.[scene.phraseGroup] : null;
  if (phraseGroup) {
    const phrases = (phraseGroup.phrases ?? []).slice(0, 5).join(' / ');
    lines.push(`她习惯的说法（${clip(phraseGroup.meaning, 30)}）：${clip(phrases, 80)}`);
  }
  const behavior = scene.behavior ? data.behaviors?.[scene.behavior] : null;
  if (behavior) {
    lines.push(`反应方向：${clip(behavior.name, 20)}——${clipSentences(behavior.response, 70)}`);
  }
  for (const keyword of (scene.terms ?? []).slice(0, 3)) {
    const term = data.terms?.[keyword];
    if (term) lines.push(`关于「${keyword}」：${clipSentences(term.meaning, 70)}`);
  }
  return lines;
}

/**
 * 渲染一段 ≤ budget 字符的记忆召回；无命中返回空串。
 * 场景按相关度顺序填充预算：主场景先占，剩余额度才给第二名。
 */
export function renderRecall(message, data, options = {}) {
  const budget = Number.isFinite(options.budget) ? options.budget : (data.budgetChars ?? 700);
  const selected = selectRecall(message, data, { maxScenes: options.maxScenes });
  if (selected === null) return '';
  // 预算小到连表头都放不下时整段放弃，不要让注入超过约定上限。
  if (HEADER.length > budget) return '';

  const kept = [HEADER];
  let used = HEADER.length;
  for (const entry of selected.scenes) {
    for (const line of sceneLines(entry, data)) {
      const cost = line.length + 1;
      if (used + cost > budget) {
        // 主场景之外的内容挤不进预算就整体放弃，避免半截场景误导模型。
        return kept.length === 1 ? '' : kept.join('\n');
      }
      kept.push(line);
      used += cost;
    }
  }
  return kept.join('\n');
}

const SEASONS_SOUTH = ['夏季', '夏季', '秋季', '秋季', '秋季', '冬季', '冬季', '冬季', '春季', '春季', '春季', '夏季'];
const SEASONS_NORTH = ['冬季', '冬季', '春季', '春季', '春季', '夏季', '夏季', '夏季', '秋季', '秋季', '秋季', '冬季'];

function dayPeriod(hour) {
  if (hour >= 0 && hour <= 4) return '凌晨';
  if (hour >= 5 && hour <= 7) return '早上';
  if (hour >= 8 && hour <= 10) return '上午';
  if (hour >= 11 && hour <= 12) return '中午';
  if (hour >= 13 && hour <= 17) return '下午';
  if (hour >= 18 && hour <= 22) return '晚上';
  return '深夜';
}

const GRANULARITIES = new Set(['minute', 'hour', 'period']);

/**
 * 归一化时间粒度。
 *
 * 默认 `hour`：宿主只在快照文本变化时才追加新快照，精确到分钟会让每轮都
 * 产生一条 200–500 字的新快照；降到整点后，同一个小时窗口内文本字节稳定。
 * `period` 更省（一天 7 段），`minute` 保留旧的精确输出。
 */
function normalizeGranularity(value) {
  return GRANULARITIES.has(value) ? value : 'hour';
}

/** 按粒度渲染钟点：minute 保留 HH:MM，hour 只到整点，period 只给时段。 */
function clockText(hourText, minuteText, hour, granularity) {
  const period = dayPeriod(hour);
  if (granularity === 'minute') return `${hourText}:${minuteText}，${period}`;
  if (granularity === 'period') return period;
  return hour === 0 ? `${period}零点` : `${period} ${hour} 点`;
}

/**
 * 渲染灰泽满所在地的本地时间/季节。
 * @param {Date} now
 * @param {string} timeZone IANA 时区；非法时回落到系统时区。
 * @param {{southernHemisphere?: boolean, granularity?: 'minute'|'hour'|'period'}} options
 */
export function renderTime(now = new Date(), timeZone = 'Australia/Melbourne', options = {}) {
  const southern = options.southernHemisphere !== false;
  const granularity = normalizeGranularity(options.granularity);
  let resolvedZone = timeZone;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: resolvedZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    formatter.format(now);
  } catch {
    resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: resolvedZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const month = Number(parts.month);
  const hour = Number(parts.hour);
  const seasonIndex = Math.max(0, Math.min(11, month - 1));
  const season = `${southern ? '南半球' : '北半球'}${(southern ? SEASONS_SOUTH : SEASONS_NORTH)[seasonIndex]}`;
  return `灰泽满所在地（虚拟澳洲）当地：${parts.year}-${parts.month}-${parts.day} ${parts.weekday} ${clockText(parts.hour, parts.minute, hour, granularity)}，${season}。`;
}

/** 组装要写进 systemPrompt.context 的完整文本（时间 + 召回）。 */
export function buildContextText({
  message,
  data,
  now,
  timeZone,
  recall = true,
  timeContext = true,
  budget,
  maxScenes,
  southernHemisphere = true,
  granularity = 'hour',
} = {}) {
  const parts = [];
  if (timeContext) parts.push(renderTime(now, timeZone, { southernHemisphere, granularity }));
  if (recall && data) {
    const text = renderRecall(message, data, { budget, maxScenes });
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}
