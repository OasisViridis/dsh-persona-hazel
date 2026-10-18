import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContextText, renderRecall, renderTime, selectRecall, similarity } from '../recall.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(HERE, '..', 'recall-data.json'), 'utf8'));

function sceneOf(message) {
  const selected = selectRecall(message, DATA);
  return selected?.scene?.id ?? null;
}

test('被夸命中 praise 场景', () => {
  assert.equal(sceneOf('你声音好好听啊'), 'praise');
});

test('“说好的八点直播呢”优先命中催播而不是被戳穿', () => {
  assert.equal(sceneOf('说好的八点直播呢'), 'misslive');
});

test('“一个人直播会孤独吗”命中孤独场景', () => {
  assert.equal(sceneOf('一个人直播会孤独吗'), 'lonely');
});

test('“你前辈是谁”命中同行场景，不命中被夸', () => {
  assert.equal(sceneOf('你前辈是谁'), 'peer');
});

test('“今天考试考了222名”命中考试场景', () => {
  assert.equal(sceneOf('今天考试考了222名'), 'exam');
});

test('擦边内容命中越界场景', () => {
  assert.equal(sceneOf('小姐姐发点擦边的'), 'boundary');
});

test('身份追问命中身份场景', () => {
  assert.equal(sceneOf('你是虚拟主播吗'), 'identity');
});

test('绿冻关系命中粉丝场景', () => {
  assert.equal(sceneOf('绿冻重要吗'), 'fans');
});

test('干活消息不强行召回人格样本', () => {
  assert.equal(selectRecall('帮我看看这个 TypeScript 代码为什么报错', DATA), null);
});

test('无场景命中时 bigram 兜底可用', () => {
  const tiny = {
    scenes: [],
    samples: { miss_1: { id: 'miss_1', user: '粉丝问：灰泽满今晚还来吗？', reply: '可能不来了，躺一会儿。' } },
    fallbackThreshold: 0.16,
  };
  const selected = selectRecall('灰泽满今晚还来吗', tiny);
  assert.ok(selected !== null);
  assert.equal(selected.fallback, true);
  assert.equal(selected.scene, null);
});

test('召回文本有明确边界与“不要照抄”提示', () => {
  const text = renderRecall('你声音好好听啊', DATA);
  assert.match(text, /记忆召回/);
  assert.match(text, /不要照抄/);
  assert.match(text, /praise|被夸|好听/);
});

test('召回文本受 budgetChars 约束', () => {
  for (const budget of [200, 300, 500]) {
    const text = renderRecall('你是不是在敷衍我', DATA, { budget });
    assert.ok(text.length <= budget, `budget ${budget} exceeded: ${text.length}`);
  }
});

test('无命中时返回空串', () => {
  assert.equal(renderRecall('帮我把这个函数重构成 async', DATA), '');
});

test('身份场景即使没有样本也能给出身份提示', () => {
  const text = renderRecall('你是虚拟主播吗', DATA);
  assert.match(text, /风纪委员/);
});

test('时区渲染：墨尔本当地日期/时间/季节', () => {
  const fixed = new Date('2026-10-18T13:41:00Z'); // 墨尔本 AEDT = 次日 00:41
  const text = renderTime(fixed, 'Australia/Melbourne');
  assert.match(text, /2026-10-19/);
  assert.match(text, /00:41/);
  assert.match(text, /凌晨/);
  assert.match(text, /南半球春季/);
});

test('非法时区不抛错（回落到系统时区）', () => {
  assert.doesNotThrow(() => renderTime(new Date(), 'Not/AZone'));
});

test('southernHemisphere=false 时使用北半球季节', () => {
  const january = new Date('2026-01-15T00:00:00Z');
  assert.match(renderTime(january, 'Australia/Melbourne'), /南半球夏季/);
  assert.match(renderTime(january, 'Asia/Shanghai', { southernHemisphere: false }), /北半球冬季/);
  const july = new Date('2026-07-15T00:00:00Z');
  assert.match(renderTime(july, 'Australia/Melbourne'), /南半球冬季/);
  assert.match(renderTime(july, 'Asia/Shanghai', { southernHemisphere: false }), /北半球夏季/);
});

test('buildContextText 同时包含时间与召回', () => {
  const text = buildContextText({
    message: '你声音好好听啊',
    data: DATA,
    now: new Date('2026-10-18T13:41:00Z'),
    timeZone: 'Australia/Melbourne',
  });
  assert.match(text, /2026-10-19/);
  assert.match(text, /记忆召回/);
});

test('相似度：同一句为 1，无关句接近 0', () => {
  assert.equal(similarity('灰泽满今晚来吗', '灰泽满今晚来吗'), 1);
  assert.ok(similarity('灰泽满今晚来吗', '帮我重构代码') < 0.2);
});

test('泛化关键词不误伤日常消息', () => {
  assert.equal(sceneOf('你平时喜欢玩什么游戏'), 'game');
  assert.equal(sceneOf('这颜色好看吗'), null);
  assert.equal(sceneOf('帮我写代码'), null);
  assert.equal(sceneOf('这个重要吗'), null);
  assert.equal(sceneOf('身份验证失败'), null);
  assert.equal(sceneOf('你的身份是什么'), 'identity');
});

test('补充场景覆盖：打招呼、好感、旧身份、越界、关心、地点、同行、情绪', () => {
  assert.equal(sceneOf('你好'), 'greet');
  assert.equal(sceneOf('我好喜欢你'), 'praise');
  assert.equal(sceneOf('你以前叫什么'), 'identity');
  assert.equal(sceneOf('叫老公'), 'boundary');
  assert.equal(sceneOf('记得吃饭'), 'care');
  assert.equal(sceneOf('你最近还好吗'), 'care');
  assert.equal(sceneOf('去过迪士尼吗'), 'place');
  assert.equal(sceneOf('久远澪呢'), 'peer');
  assert.equal(sceneOf('我失恋了'), 'comfort');
  assert.equal(sceneOf('你难过吗'), null);
  assert.equal(sceneOf('帮我改这段代码'), null);
  assert.equal(sceneOf('能说一句高考加油吗'), 'cheer');
  assert.equal(sceneOf('你玩第五人格吗'), 'fifth');
  assert.match(renderRecall('能说一句高考加油吗', DATA), /高三|说个鬼/);
});

test('世界事实/偏好通过 stories/preferences 注入', () => {
  assert.equal(sceneOf('三好学生得了多少票'), 'exam');
  assert.match(renderRecall('三好学生得了多少票', DATA), /38/);
  assert.equal(sceneOf('你写的小说叫什么'), 'novel');
  assert.match(renderRecall('你写的小说叫什么', DATA), /乌色月/);
  assert.equal(sceneOf('满妈最近怎么样'), 'family');
  assert.match(renderRecall('满妈最近怎么样', DATA), /满妈/);
  assert.equal(sceneOf('小学那个女同学'), 'classmate');
  assert.match(renderRecall('小学那个女同学', DATA), /女同学|女仆/);
  assert.equal(sceneOf('你玩宝可梦吗'), 'game');
  assert.match(renderRecall('你玩宝可梦吗', DATA), /宝可梦/);
});

test('行为召回包含 response 正文，不只是标签', () => {
  const text = renderRecall('你声音好好听啊', DATA);
  assert.match(text, /反应方向：被夸时嘴硬否认——/);
  assert.match(text, /口是心非|自嘲/);
});

test('数据完整性：场景样本 id 全部存在', () => {
  for (const scene of DATA.scenes) {
    for (const id of scene.samples) {
      assert.ok(DATA.samples[id], `missing sample ${id} in scene ${scene.id}`);
    }
    for (const id of scene.stories ?? []) {
      assert.ok(DATA.stories[id], `missing story ${id} in scene ${scene.id}`);
    }
    for (const id of scene.preferences ?? []) {
      assert.ok(DATA.preferences[id], `missing preference ${id} in scene ${scene.id}`);
    }
  }
  for (const scene of DATA.scenes) {
    assert.ok((scene.keywords?.length ?? 0) + (scene.patterns?.length ?? 0) > 0, `scene ${scene.id} has no trigger`);
  }
});
