/**
 * plugin-core.mjs — dsh-persona-hazel 的插件核心（不依赖 @deepseek-ai/*）。
 *
 * 这里放 `apply`、区段/上下文常量与文件热重载；`index.js` 只负责
 * Schemastery 配置 schema 与导出。拆开是为了让 `test/plugin.test.mjs`
 * 可以在没有 DSH 依赖的 CI 环境里用 fake ctx 直接验证注册逻辑。
 */
import { readFileSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContextText } from "./recall.mjs";

/** 区段名：刻意不含 "persona"，绕过 router-flash 的 persona 区段过滤。 */
export const SECTION_NAME = "hazel:soul";
/** 动态运行时上下文名（order 200，位于宿主自带的沙箱/审批上下文之后）。 */
export const CONTEXT_NAME = "hazel:recall";
/** 插件内置的人设卡（与 HazePersona/persona/soul-card.md 同源）。 */
const PERSONA_FILE = join(dirname(fileURLToPath(import.meta.url)), "persona.txt");
/** 构建产物：persona/ 的人格数据 + scenes.json 编译出的召回数据。 */
const RECALL_FILE = join(dirname(fileURLToPath(import.meta.url)), "recall-data.json");
/** 运行时上下文顺序：宿主 CONTEXT_ORDERS 只用到 110/115/120，外部可用任意值。 */
const CONTEXT_ORDER = 200;
/** 召回预算的安全范围。 */
const MIN_BUDGET = 200;
const MAX_BUDGET = 2000;

/** 从一条 user 消息里取出纯文本（忽略非文本块）。 */
export function messageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** 把预算夹在安全范围内。 */
function clampBudget(value) {
  if (!Number.isFinite(value)) return 700;
  return Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Math.round(value)));
}

/**
 * Cordis 插件入口。
 * @param ctx Cordis 上下文（需要 systemPrompt 服务）。
 * @param config 已由 index.js 的 Config schema 校验/补默认值的配置。
 */
export function apply(ctx, config) {
  let active = null;
  let recallData = null;
  let timer = undefined;
  const watchers = [];
  /** 本轮/最近一次用户消息（key 是 agent 对象）；由 agent/inbox/claimed 在组装前写入。 */
  const latestUserText = new WeakMap();

  const register = (text) => {
    if (active) {
      // systemPrompt.section() 返回的是 Cordis effect 的 DISPOSER 函数，
      // 直接调用它来注销，不要调用 .dispose()。
      active();
      active = null;
    }
    if (text) {
      active = ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: config.order,
        text,
        ...(config.complete ? { complete: true } : {}),
      });
    }
  };

  const loadRecall = () => {
    try {
      return JSON.parse(readFileSync(RECALL_FILE, "utf8"));
    } catch {
      return null;
    }
  };

  const refresh = () => {
    let text;
    try {
      text = readFileSync(PERSONA_FILE, "utf8");
    } catch {
      text = config.fallback;
    }
    register(text);
    recallData = loadRecall();
  };

  const stopWatch = () => {
    clearTimeout(timer);
    timer = undefined;
    while (watchers.length > 0) {
      const watcher = watchers.pop();
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
  };

  const scheduleRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, config.debounceMs);
  };

  const startWatch = () => {
    stopWatch();
    if (!config.watch) return;
    for (const file of [PERSONA_FILE, RECALL_FILE]) {
      try {
        watchers.push(watch(file, { persistent: false }, scheduleRefresh));
      } catch {
        // 文件缺失：fallback 已注册 / recall 不可用；重载尽力而为。
      }
    }
  };

  /** 当前用户消息：优先用 claimed 事件捕获的文本，空则回退到空串。 */
  const currentMessage = (agent) => (agent ? (latestUserText.get(agent) ?? "") : "");

  ctx.effect(() => {
    refresh();
    startWatch();

    const disposers = [];
    // 捕获本轮用户消息：agent-loop 在组装系统提示词之前 claim inbox 并发出该事件。
    if (typeof ctx.on === "function") {
      disposers.push(
        ctx.on("agent/inbox/claimed", (payload) => {
          const agent = payload?.agent;
          const message = payload?.message;
          const text = messageText(message);
          // 只捕获真实用户消息；runtime-context 等注入消息不作为召回输入。
          if (agent && text && message?.source?.kind === "user") latestUserText.set(agent, text);
        }),
      );
    }
    // 动态运行时上下文：时间 + 按消息召回；文本变化时追加新快照并标注 supersedes，旧快照留在历史（由宿主压缩处理）。
    if (typeof ctx.systemPrompt.context === "function") {
      disposers.push(
        ctx.systemPrompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: (assembly) => {
            if (!config.recall && !config.timeContext) return "";
            const text = buildContextText({
              message: currentMessage(assembly?.agent),
              data: config.recall ? recallData : null,
              now: new Date(),
              timeZone: config.timeZone,
              recall: config.recall,
              timeContext: config.timeContext,
              budget: clampBudget(config.recallBudgetChars),
              southernHemisphere: config.southernHemisphere,
            });
            return text;
          },
        }),
      );
    }

    return () => {
      stopWatch();
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* already disposed */
        }
      }
      if (active) {
        active(); // disposer 函数，不是对象
        active = null;
      }
    };
  }, "persona-hazel.section()");
}
