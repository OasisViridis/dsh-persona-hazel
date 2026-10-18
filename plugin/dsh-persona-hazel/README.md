# dsh-persona-hazel

灰泽满（Hazel）人格**全局注入插件**：两层注入，所有会话生效，不依赖 agent preset。

1. **`hazel:soul`（静态系统区段）**：把 `persona.txt`（同源于 HazePersona/persona/soul-card.md，由仓库根部 `deploy.ps1` 同步）注册为全局系统提示词区段。区段名刻意**不含 "persona"**：router-flash 的 `applyPersona` 会过滤名字匹配 `/persona/i` 的区段（`soul:persona` 因此失效），`hazel:soul` 绕过该过滤。
2. **`hazel:recall`（动态运行时上下文）**：按本轮用户消息，从 `recall-data.json` 召回 **1 个情境**的真实样本/措辞/行为/名词/核心记忆/偏好，并附灰泽满所在地（默认 `Australia/Melbourne`）的本地时间与季节。运行时上下文由宿主以 user 角色快照承载；文本变化时追加新快照并标注 supersedes，旧快照留在历史（由 DSH 压缩处理）。

## 数据流

```
persona/speech/voice_samples.json   ┐
persona/speech/phrases.json         │
persona/behavior/behaviors.json     │
persona/world/terms.json            │
persona/world/core_stories.json     │
persona/world/preferences.json      ├─ scripts/build-recall-data.mjs ─→ plugin/dsh-persona-hazel/recall-data.json
persona/recall/scenes.json          ┘        （校验 id 存在、预算、正则）
```

- `persona/recall/scenes.json` 是场景表的**唯一事实来源**：只做「用户消息情境 → 已有素材」的映射，不改写样本原文；`scripts/build-recall-data.mjs` 会校验所有被引用的 sample / phraseGroup / behavior / term / story / preference 是否存在。
- 改完 `persona/` 下的数据后重跑 `node scripts/build-recall-data.mjs`（`deploy.ps1` 也会自动重建）。`--check` 模式用于校验构建产物是否最新；`scripts/check.sh` 已接入。
- 召回是确定性关键词/正则 + 字符 bigram 兜底（见 `recall.mjs`），不调用 embedding、不联网；每轮文本受 `recallBudgetChars`（默认 700）约束。

## 配置

`cordis.patch.yml` 里 `persona-hazel` 行的 `config` 全部可选，缺失不会炸插件树：

| 字段 | 默认 | 含义 |
|---|---|---|
| `order` | `0` | `hazel:soul` 区段顺序 |
| `complete` | `false` | 把人设卡当作完整系统提示词 |
| `fallback` | `""` | persona.txt 缺失时的兜底文本 |
| `watch` | `true` | persona.txt / recall-data.json 变更热重载 |
| `debounceMs` | `300` | 热重载防抖毫秒 |
| `recall` | `true` | 启用动态人格召回 |
| `recallBudgetChars` | `700` | 每轮召回文本上限（运行时夹在 200..2000） |
| `timeContext` | `true` | 注入灰泽满所在地时间/季节 |
| `timeZone` | `Australia/Melbourne` | 她的 IANA 时区；非法值回落到系统时区 |
| `southernHemisphere` | `true` | 季节按南半球显示 |

示例：

```yaml
- insert:
    - id: persona-hazel
      name: 'dsh-persona-hazel'
      config:
        recall: true
        recallBudgetChars: 500
        timeZone: Australia/Melbourne
```

## 安装

```powershell
# 仓库根目录执行；默认桌面端 desktop profile，web profile 用 -Profile web
.\deploy.ps1
.\deploy.ps1 -Verify   # 只校验接线 + recall 数据是否最新
```

`deploy.ps1` 在目标 profile（`$DSH_HOME\profiles\<profile>`）里幂等维护：

1. `persona.txt`（从 soul-card.md 同步）；
2. `recall-data.json`（从 persona/ 重建）；
3. `package.json` 的 `"dsh-persona-hazel": "link:<仓库路径>/plugin/dsh-persona-hazel"`；
4. `node_modules\dsh-persona-hazel` 链接（缺则建 junction；桌面端 pnpm 已建软链时不改动）；
5. `cordis.patch.yml` 的 `persona-hazel` insert 行。

> 桌面端（DSH 0.2.x）由 Electron 独占管理 `profiles/desktop`，`dsh plugin --profile desktop ...` 会被拒绝，
> 因此本地开发插件只能这样接线；本插件是普通插件，**不要**写进 `dsh.profile.bundles`。

新增插件/改插件代码后需**完整重启 DSH**（桌面端：托盘退出后重新打开；网页端：杀 dsh web 进程 → 弹窗点"重新启动"）。只改 `persona.txt` / `recall-data.json` 会热重载。

## 验证

```powershell
powershell -NoProfile -File scripts/check.ps1   # 权威静态检查（语法 / recall 同步 / 单测 / 人设卡一致性）
node scripts/persona-eval.mjs                   # 17 场景（12 人格 + 5 世界事实）（需要 DSH 在 19387 运行）
node scripts/persona-eval.mjs --require-context # 复测用：每个会话都必须收到 hazel:recall 快照（2026-10-18 实测 17/17）
node deploy\verify-live.mjs                     # 端到端冒烟（身份锚点）
```

## 文件

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口：Schemastery 配置 schema + 导出 |
| `plugin-core.mjs` | 插件行为：`hazel:soul` 区段 + `hazel:recall` 运行时上下文 + 热重载 |
| `recall.mjs` | 纯召回逻辑（匹配 / 预算 / 时间渲染），不依赖 DSH，可单测 |
| `recall-data.json` | 构建产物：scenes + 样本 + 措辞 + 行为 + 名词（不要手改） |
| `persona.txt` | 人设卡运行时副本（deploy.ps1 同步；不要手改） |
| `test/recall.test.mjs` | `node --test` 单测（场景命中 / 预算 / 时间 / 数据完整性） |

## 边界

- **不做输出后处理**：DSH 没有响应改写 seam，上游 bot 的 `clean_reply`（括号/省略号/防复读）只能在提示词与素材层解决，不要在本插件里加「事后清洗」。
- **不注入 legendary 原话**：固定梗原话容易诱发复读，召回只给情境样本/措辞/行为提示。
- `recall-data.json` 是构建产物，**不要手改**；改 `persona/` 或 `scenes.json` 后重跑构建脚本。

## 卸载

1. 删 `$DSH_HOME\profiles\<profile>\cordis.patch.yml` 的 `persona-hazel` insert 行
2. 删同目录 `package.json` 的 `dsh-persona-hazel` link 条目
3. 删 `node_modules\dsh-persona-hazel`（junction：`cmd /c rmdir "<profile>\node_modules\dsh-persona-hazel"`，不要用 `Remove-Item -Recurse`）

改完完整重启 DSH 生效。
