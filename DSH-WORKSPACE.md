# DSH-WORKSPACE.md — HazePersona 接管层（DSH agent 维护）

本文件承载项目专属的 DSH 部署与人格维护规则，是 `AGENTS.md` 权威顺序第 6 层引用的项目资料。TheMasterplan 规则（`AGENTS.md` + `core/` + `profiles/` + `adapters/`）是交付治理层；本文件只管"灰泽满人格怎么部署进 DSH、怎么改"。

## 事实来源与唯一性

- `persona/` 是人格数据的**唯一事实来源**：
  - `persona/soul-card.md` — **部署源**：soul.md 风格全局人设卡（当前生效版本，2026-10-18 E 起为核心卡 4,032 字；世界/记忆细节由 `hazel:recall` 补，不要把细节塞回静态卡），deploy.ps1 同步为 `plugin/dsh-persona-hazel/persona.txt`
  - `persona/haze-persona.txt` — soul-card.md 的纯文本镜像（与 soul-card.md 字节一致；check.sh/check.ps1 强制校验，改人格只改 soul-card.md 再同步）
  - `persona/recall/scenes.json` — **召回场景表**（消息情境 → voice_samples / phrases / behaviors / terms 的映射），只做映射，不改写样本原文
  - `persona/` 子目录（core/behavior/speech/world）是 Hzm-AI-Bot 原始蒸馏 JSON：静态人设卡与召回数据都从这里取，但它们是上游证据，**不要当注入口手改**；要改先确认属于本项目新增还是上游数据
- 运行时副本：
  - `plugin\dsh-persona-hazel\persona.txt`（由 deploy.ps1 从 soul-card.md 单向同步，不要直接改）
  - `plugin\dsh-persona-hazel\recall-data.json`（由 `scripts/build-recall-data.mjs` 从 persona/ 构建，不要直接改）

## 硬规则

1. 部署一律走 `.\deploy.ps1`，不要手工复制；默认目标是**桌面端** `~/.dsh/profiles/desktop`（旧版网页端用 `-Profile web`），改完用 `.\deploy.ps1 -Verify` 自检。
2. 不修改 `persona/` 下任何 Hzm-AI-Bot 原始 JSON 的内容（那是上游证据）。
3. **部署通道只有 `dsh-persona-hazel` 插件**（静态区段 `hazel:soul` + 动态上下文 `hazel:recall`）：
   - **不要用 dsh-soul-md / `$DSH_HOME\soul.md` 部署**——router-flash（默认预设）的 `applyPersona` 会过滤名字匹配 `/persona/i` 的区段，`soul:persona` 会被清掉（实测失效）。
   - **不要用 agent preset 方案**（用户已明确拒绝，2026-08-16）。
   - **插件区段名不能含 "persona"**（会被 router-flash 过滤）；不能与 `hazel:soul` / `hazel:recall` 重名。
   - 不要重复部署（另一个同机制插件/文件会造成双注入）。
   - **桌面端 profile 由 Electron 独占管理**：`dsh plugin --profile desktop ...` 会被拒绝（`managed exclusively by the Electron application`），只能通过 profile 文件接线：`package.json` 的 `link:` 依赖 + `node_modules` 链接 + **`dsh.profile.bundles` 选中 `dsh-persona-hazel`**。
   - **必须是 bundle**：插件包自带 `dsh.bundle.patch`（`plugin/dsh-persona-hazel/cordis.patch.yml`），由 profile 的 `dsh.profile.bundles` 选中后加载。DSH 插件页**只列 bundle**——不带 bundle 元数据的普通插件在插件页和 `plugin_manager` 里都不出现（2026-10-22 用户报"插件页看不见人格插件"即此因），也就没法从界面开关。
   - **双注入禁忌（两处只能留一处）**：选中 bundle 之后，profile 的 `cordis.patch.yml` 里**不要**再 insert `persona-hazel` 行；`deploy.ps1` 会清掉遗留的 insert 行，`-Verify` 会把它当失败。
   - **不要加输出后处理**：DSH 没有响应改写 seam；括号/省略号/防复读只能靠提示词与素材层，不要在插件里做「收到模型回复后再清洗」。
4. 蒸馏原则（来自 persona-resound 方法论）：样本 > 规则；提示词不放具体台词（原话下沉到行为/措辞层）；行为 > 标签（写"什么情境怎么反应"）；措辞/括号等从素材层根治，不靠提示词硬约束堆砌。
5. soul-card.md 的开头声明（"你是灰泽满，但也是用户装进 DSH 的协作者"）是全局注入的必要设计——所有会话都带人设，包括干活会话；不要把它改成纯扮演版。

## 维护命令

- 部署：`.\deploy.ps1`（探测 profile，桌面端优先；同步 persona.txt + 重建 recall-data.json + 幂等接线：link 依赖 / node_modules 链接 / `dsh.profile.bundles` 选中 / 清掉旧 insert 行；`-DryRun` 只预览，`-Profile web` 处理旧 profile）
- 部署自检：`.\deploy.ps1 -Verify`（persona.txt 同步 / recall-data 最新 / link 依赖 / node_modules 链接 / bundles 选中 / 无遗留 insert 行，失败退出码 1）
- 召回数据重建：`node scripts\build-recall-data.mjs`（改 `persona/recall/scenes.json` 或 speech/behavior/world 源数据后运行；`--check` 只校验，`--dry-run` 只统计）
- 召回单测：`node --test plugin\dsh-persona-hazel\test\recall.test.mjs`
- 首次安装/改插件代码：完整重启 DSH（桌面端托盘退出后重新打开；网页端杀 dsh web 进程→弹窗重启）；之后 persona.txt / recall-data.json 变更热重载
- 关闭人设：从 `dsh.profile.bundles` 去掉 `dsh-persona-hazel`（等价于在 DSH 插件页关掉它）+ 删 node_modules 链接 + package.json link 条目（见 plugin/dsh-persona-hazel/README.md）
- 人格评测：`node scripts\persona-eval.mjs`（17 个场景（12 人格 + 5 世界事实），需 DSH 在 `http://127.0.0.1:19387` 运行；`--only`、`--json`、`--strict` 可选；插件重启后用 `--require-context` 验证 `hazel:recall` 快照注入；2026-10-18 10:54 重启后实测 17/17）
- 端到端验证：`node deploy\verify-live.mjs`（默认对 `$DSH_WEB_URL`，桌面端为 `http://127.0.0.1:19387`；用 `$DSH_HOME\.credentials.yaml` 的 browser-session 密钥签发 cookie 过 `/api` 认证；省略预设参数时用宿主默认）
- 静态一致性：`scripts/check.sh` / `scripts/check.ps1`（TheMasterplan 权威验证入口，含 recall 数据同步与单测）
