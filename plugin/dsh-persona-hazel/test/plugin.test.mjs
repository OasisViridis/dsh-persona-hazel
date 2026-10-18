import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, CONTEXT_NAME, SECTION_NAME } from '../plugin-core.mjs';

/** 最小 Cordis ctx 替身：只实现插件用到的 section/context/on/effect。 */
function createFakeContext() {
  const state = { section: null, context: null, listeners: new Map(), disposers: [] };
  const ctx = {
    systemPrompt: {
      section(options) {
        state.section = options;
        return () => {};
      },
      context(options) {
        state.context = options;
        return () => {};
      },
    },
    on(name, listener) {
      state.listeners.set(name, listener);
      return () => {};
    },
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') state.disposers.push(cleanup);
      return () => {};
    },
  };
  return { ctx, state };
}

const CONFIG = {
  order: 0,
  complete: false,
  fallback: '',
  watch: false,
  debounceMs: 300,
  recall: true,
  recallBudgetChars: 700,
  timeContext: true,
  timeZone: 'Australia/Melbourne',
  southernHemisphere: true,
};

test('插件注册 hazel:soul 区段与 hazel:recall 上下文', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, CONFIG);
  assert.equal(SECTION_NAME, 'hazel:soul');
  assert.equal(CONTEXT_NAME, 'hazel:recall');
  assert.equal(state.section.name, 'hazel:soul');
  assert.equal(state.section.order, 0);
  assert.match(state.section.text, /灰泽满/);
  assert.equal(state.context.name, 'hazel:recall');
  assert.equal(typeof state.context.text, 'function');
});

test('claimed 事件后，运行时上下文包含时间与人格召回', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, CONFIG);
  const agent = {};
  const listener = state.listeners.get('agent/inbox/claimed');
  assert.equal(typeof listener, 'function');
  listener({
    agent,
    message: { source: { kind: 'user' }, content: [{ type: 'text', text: '你声音好好听啊' }] },
  });
  const text = state.context.text({ agent });
  assert.match(text, /灰泽满所在地/);
  assert.match(text, /记忆召回/);
  assert.match(text, /好听|被夸|别抬举/);
});

test('连续两轮 claimed 后召回跟随最新用户消息', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, CONFIG);
  const agent = {};
  const listener = state.listeners.get('agent/inbox/claimed');
  assert.equal(typeof listener, 'function');

  listener({
    agent,
    message: { source: { kind: 'user' }, content: [{ type: 'text', text: '你声音好好听啊' }] },
  });
  const first = state.context.text({ agent });
  assert.match(first, /记忆召回/);
  assert.match(first, /被夸|好听|别抬举/);

  listener({
    agent,
    message: { source: { kind: 'user' }, content: [{ type: 'text', text: '说好的八点直播呢' }] },
  });
  const second = state.context.text({ agent });
  assert.match(second, /记忆召回/);
  assert.match(second, /催播|失约|直播/);
  assert.notEqual(first, second);
});

test('没有用户消息时只注入时间，不强行召回', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, CONFIG);
  const text = state.context.text({});
  assert.match(text, /灰泽满所在地/);
  assert.doesNotMatch(text, /记忆召回/);
});

test('recall/timeContext 关闭时上下文为空', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, { ...CONFIG, recall: false, timeContext: false });
  assert.equal(state.context.text({}), '');
});

test('非用户来源的消息不写入召回捕获', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, CONFIG);
  const agent = {};
  state.listeners.get('agent/inbox/claimed')?.({
    agent,
    message: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '你声音好好听啊' }] },
  });
  const text = state.context.text({ agent });
  assert.doesNotMatch(text, /记忆召回/);
});
