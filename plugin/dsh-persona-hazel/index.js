/**
 * dsh-persona-hazel — 灰泽满（Hazel）人格全局注入插件。
 *
 * 本文件只负责 Schemastery 配置 schema 与导出；插件行为在 plugin-core.mjs。
 * 两层注入：
 * 1. `hazel:soul` 系统提示词区段：插件内打包的人设卡（persona.txt）。
 * 2. `hazel:recall` 动态运行时上下文：按本轮用户消息召回情境样本 + 本地时间。
 *
 * 配置（cordis.patch.yml 的 config 均可选，全部带默认值——缺失默认值会
 * 让配置校验失败并拖垮插件树，dsh web 直接启动失败）：
 * - order:             区段顺序（默认 0）
 * - complete:          把人设卡当作完整系统提示词（默认 false）
 * - fallback:          文件缺失/不可读时的兜底文本（默认 ""）
 * - watch:             文件变更热重载（默认 true）
 * - debounceMs:        重载防抖毫秒（默认 300）
 * - recall:            启用动态人格召回（默认 true）
 * - recallBudgetChars: 每轮召回文本上限（默认 700，运行时夹在 200..2000）
 * - recallMaxScenes:   每轮最多召回几个场景（默认 2，运行时夹在 1..3）
 * - timeContext:       注入灰泽满所在地时间（默认 true）
 * - timeGranularity:   时间粒度 minute / hour / period（默认 hour）
 * - timeZone:          她的 IANA 时区（默认 Australia/Melbourne）
 * - southernHemisphere: 季节按南半球显示（默认 true）
 */
import z from "@deepseek-ai/schemastery";
import { apply, CONTEXT_NAME, SECTION_NAME } from "./plugin-core.mjs";

/** Cordis 插件名。 */
const name = "persona-hazel";
/** 本行注入的提示词注册表。 */
const inject = ["systemPrompt"];

/** 运行时 schema：全部字段带默认值，缺省配置也能安全挂载。 */
const Config = z.object({
  order: z.number().default(0),
  complete: z.boolean().default(false),
  fallback: z.string().default(""),
  watch: z.boolean().default(true),
  debounceMs: z.number().default(300),
  recall: z.boolean().default(true),
  recallBudgetChars: z.number().default(700),
  recallMaxScenes: z.number().default(2),
  timeContext: z.boolean().default(true),
  timeGranularity: z.string().default("hour"),
  timeZone: z.string().default("Australia/Melbourne"),
  southernHemisphere: z.boolean().default(true),
});

export { Config, CONTEXT_NAME, SECTION_NAME, apply, inject, name };
