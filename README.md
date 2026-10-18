# HazePersona — 灰泽满（Hazel）人格蒸馏与多端部署（DSH / Codex）

把 [Hzm-AI-Bot](https://github.com/MureasAm/Hzm-AI-Bot)（灰泽满 · 基于素材驱动的 LLM 角色一致性对话框架）已蒸馏的人格数据，再蒸馏为 DSH（DeepSeek Harness）可用的**人格插件**（`dsh-persona-hazel`，全局注入，所有会话生效，不依赖 agent preset）以及 Windows Codex 全局指令（`model_instructions_file`）。方法论来自 [persona-resound](https://github.com/MureasAm/persona-resound)（只还原既有的人，不原创设计）。

## 目录结构

```
HazePersona/
├── README.md                 # 本文件（手册）
├── AGENTS.md                 # 自管治理规则与项目事实
├── ADOPTION.md               # TheMasterplan 采用记录
├── DSH-WORKSPACE.md          # DSH 部署与人格维护规则
├── PERSONA-NOTICE.md         # 角色权利与免责声明
├── THIRD_PARTY_NOTICES.md    # 第三方许可与声明
├── deploy.ps1                # DSH 部署/同步脚本（桌面端 desktop profile 优先，web 兼容）
├── deploy/                   # 部署与运行时验证工具
│   └── verify-live.mjs       #   DSH 运行时端到端验证脚本
├── scripts/                  # 权威验证与部署脚本
│   ├── check.sh              #   TheMasterplan 权威验证入口（Bash）
│   ├── check.ps1             #   PowerShell 验证委托入口
│   ├── build-recall-data.mjs #   人格召回数据构建（persona/ → recall-data.json）
│   ├── persona-eval.mjs      #   17 场景人格评测（12 人格 + 5 世界事实，DSH 运行时）
│   └── deploy-codex.ps1      #   Codex 部署薄包装脚本
├── persona/                  # ★ 人格数据源（唯一事实来源）
│   ├── soul-card.md          #   部署源：soul.md 风格全局人设卡（当前生效版本）
│   ├── haze-persona.txt      #   soul-card.md 的纯文本镜像（完整版存档，check 强制一致）
│   ├── core/                 #   源数据：system_prompt.txt(V2草案) / traits / styles
│   ├── behavior/             #   behaviors.json（8 条行为模式）
│   ├── speech/               #   phrases.json（11 组措辞指纹）/ voice_samples.json（83 个声音样本）
│   ├── recall/               #   scenes.json（消息情境 → 样本/措辞/行为/名词的召回场景表）
│   └── world/                #   terms / core_stories / legendary / preferences / statement_final(315条)
├── plugin/dsh-persona-hazel/ # 人格注入插件（link 装入 profile）
│   ├── index.js              #   Config schema + 插件入口
│   ├── plugin-core.mjs       #   hazel:soul 区段 + hazel:recall 动态上下文 + 热重载
│   ├── recall.mjs            #   纯召回逻辑（匹配/预算/时间，可单测）
│   ├── recall-data.json      #   构建产物：scenes + 样本 + 措辞 + 行为 + 名词
│   ├── persona.txt           #   人设卡运行时副本（deploy.ps1 从 soul-card.md 同步）
│   ├── test/recall.test.mjs  #   node --test 召回单测
│   └── package.json / README.md
└── docs/
    ├── codex-deployment.md   # Codex 人格部署手册与红线
    ├── handoff-codex-deploy-20260821.md # Codex 部署任务书与验收记录
    ├── README.md             # Hzm-AI-Bot 原 README
    └── ROADMAP.md            # Hzm-AI-Bot 重构历程与踩坑记录
```

> 注：Hzm-AI-Bot 的 `*_vectors.json`（预计算向量）未随库保留——那是原工程检索层产物，DSH 静态人格注入用不到，需要时可从原仓库重跑 `precompute` 生成。

## DSH 部署方式（dsh-persona-hazel 插件全局注入）

**机制**：DSH profile（桌面端为 `~/.dsh/profiles/desktop`，旧版网页端为 `profiles/web`）里的 `dsh-persona-hazel` 插件做两层注入：

1. **`hazel:soul`**：把 `persona.txt` 注册为系统提示词区段（全局 prompt 层，order 0）；区段名避开 `/persona/i` 过滤。
2. **`hazel:recall`**：按本轮用户消息，从 `recall-data.json` 召回 1 个情境的真实样本/措辞/行为/名词/核心记忆/偏好，并附灰泽满所在地时间（默认 `Australia/Melbourne`）；由宿主以 user 角色运行时快照承载；快照变更时追加并标注 supersedes，旧快照留在历史（由 DSH 压缩处理）。

profile 侧由 `deploy.ps1` 幂等维护：`persona.txt` 同步、`recall-data.json` 重建、`package.json` 的 `link:` 依赖、`node_modules` 链接、`cordis.patch.yml` 的 `persona-hazel` insert 行。

**桌面端是默认目标**：DSH 桌面端用 Electron 独占管理 `profiles/desktop`——`dsh plugin --profile desktop ...` 会直接拒绝（`profile "desktop" is managed exclusively by the Electron application`），所以本地开发插件走 profile 文件接线；它是普通插件（非 bundle），只靠 insert 行加载，**不要**同时写进 `dsh.profile.bundles`。

**为什么不用 dsh-soul-md 的 `soul:persona`**：router-flash 预装的 `applyPersona`（`.agent-presets\router-flash\router-core.mjs`）会过滤**所有名字匹配 `/persona/i` 的区段**并替换为 router 的 neutral persona——`soul:persona` 因此在默认会话里被清掉（实测新会话不生效）。`hazel:soul` 区段名刻意避开该过滤，**任何预设下都生效**（桌面端默认预设是 `standard`，同样适用）。

**状态**：插件已装入桌面端 `desktop` profile，`persona.txt` 已同步 ✅（2026-10-18，DSH 桌面端 `0.2.0-rc.2`）。2026-10-18 10:54 重启后实测：**17/17 会话收到 `hazel:recall` 快照**（时间 + 人格召回），17 场景人格评测通过（12 人格 + 5 世界事实；其中 1 条首轮为中文数字规则误报，修正后复测通过）。

### 部署/更新

```powershell
.\deploy.ps1                 # 自动探测 profile（桌面端优先）：①同步 persona.txt ②重建 recall-data.json ③link 依赖 ④node_modules 链接 ⑤patch insert 行
.\deploy.ps1 -Profile web    # 显式指定旧版 web profile
.\deploy.ps1 -DryRun         # 只打印计划，不写文件
.\deploy.ps1 -Verify         # 只校验接线 + recall 数据是否最新，缺一项退出码 1
```

- **首次安装/改插件代码**：需**完整重启 DSH**（桌面端：托盘退出后重新打开；网页端：杀 dsh web 进程 → 弹窗点"重新启动"）。
- **改人格卡**：改 `persona\soul-card.md` → `.\deploy.ps1` → persona.txt 变更自动热重载（fs.watch，下一次组装生效），无需重启。
- **改召回数据**：改 `persona\recall\scenes.json` 或 `persona\speech|behavior|world` 下的源数据 → `.\deploy.ps1`（会重建 recall-data.json）→ 热重载，无需重启。手工重建：`node scripts\build-recall-data.mjs`。

### 使用

新开任意会话直接聊天即可；对方是"绿冻"还是普通网友由她自己的说话习惯自然处理。已运行会话不受影响。

### 验证

- 接线自检：`.\deploy.ps1 -Verify`（persona.txt 同步、recall-data 最新、link 依赖、node_modules 链接、patch 行五项）。
- 权威静态检查：`bash scripts/check.sh`（或 `powershell -NoProfile -File scripts/check.ps1`），含插件语法、recall 数据同步、召回单测、人设卡一致性。
- 人格评测：`node scripts\persona-eval.mjs`（17 个场景（12 人格：身份/被夸/被戳穿/失约/越界/孤独/时间/家乡/梗/关心/干活/晚安 + 5 世界事实：三好学生/222名/乌色月/女同学/家人）；需要 DSH 在 19387 运行）。重启插件后加 `--require-context` 可验证每个会话都收到 `hazel:recall` 快照。
- 运行时端到端（唯一入口）：`node deploy\verify-live.mjs`
  - 默认对 `$DSH_WEB_URL` 验证（桌面端 `http://127.0.0.1:19387`），第二个参数才是指定预设；省略时用宿主默认预设（桌面端 `standard`），不再硬编码 `router-flash`。
  - DSH 0.2.x 的 `/api` 需要认证：脚本用 `$DSH_HOME\.credentials.yaml` 里 `client-connection/browser-session` 的签名密钥在本地签发会话 cookie（只读、不出本机），走 `session/create → session/prompt → session/list → session/page` 取回复。
  - 回复命中"风纪委员/灰泽满/绿冻"等锚点判 PASS；2026-10-18 桌面端实测回复 **"灰泽满呀，永远16岁的风纪委员哦。"**。

## Codex 部署方式（Windows 全局指令）

**机制**：通过 `codex-keysmith` 把唯一事实源 `persona/soul-card.md` 字节级无损部署为 Windows Codex（`C:\Users\Oasis\.codex`）的全局指令（`config.toml` 顶层 `model_instructions_file`），使所有新 Codex 会话携带完整灰泽满人格。

- **手册与红线**：详见 [docs/codex-deployment.md](docs/codex-deployment.md)（含回滚、沙箱实测协议与已知限制）。
- **部署脚本**：推荐薄包装 `pwsh -NoProfile -File scripts/deploy-codex.ps1 -DryRun`（预览）/ `-Yes`（确认写入）；自动留痕 `hooks.json` 哈希以防 mnemon 钩子被隔离。
- **状态**：2026-08-21 已完成生产部署并验收（`--status` active / healthy / ready），与 DSH 侧插件并行不冲突。

## 人格数据来源与蒸馏说明

- 源人格工程：Hzm-AI-Bot（MureasAm，2026-08，V5.5+）：83 个声音样本、315 条陈述、多路检索融合、L3 行为意图分类、207 个单测。README 说"不是靠模型的聪明，而是靠数据、检索、记忆、评测这套体系"。
- 蒸馏管线（原工程）：transcribe → clean → convert-to-chat → mine-phrases → generate-statements → 向量化 → 人工审批。
- 本仓库的蒸馏：把原工程**检索注入式**的分层数据（行为/措辞/术语/记忆/梗/偏好）浓缩为**静态人格文本**，供 DSH 每次会话直接注入。这是"提示词不是越多越好"原则下的折中：DSH 不做向量检索，所以只保留高价值锚点，删除重复与低信号内容。
- `soul-card.md` 是**全局注入版人设卡**：开头声明"你是灰泽满，但也是用户装进 DSH 的协作者"，适配所有会话（含干活会话）都带人设的场景。
- 想要更强还原（检索注入、行为 L3、记忆系统），原工程是 NoneBot2 + NapCat 的独立 QQ bot，见 `docs/README.md`。

## 修改流程

1. 改 `persona/soul-card.md`（或先改 `persona/` 下的源 JSON，再蒸馏进卡）。
2. 同步与校验：
   - 权威验证：运行 `bash scripts/check.sh`（或 `powershell -NoProfile -File scripts/check.ps1`），确保三方一致。
   - DSH 部署：`.\deploy.ps1`（桌面端 desktop profile 优先，web 兼容；link 依赖/node_modules 链接/patch 行幂等；变更自动热重载，首次安装需完整重启 DSH）。
   - 部署自检：`.\deploy.ps1 -Verify`；端到端复测：`node deploy\verify-live.mjs`。
   - Codex 部署：`pwsh -NoProfile -File scripts/deploy-codex.ps1 -Yes`（详见 [docs/codex-deployment.md](docs/codex-deployment.md)）。
3. 不想全局带人设时：
   - DSH 侧：删 patch insert 行 + node_modules 链接 + package.json link 条目（见 [plugin/dsh-persona-hazel/README.md](plugin/dsh-persona-hazel/README.md) 卸载节）。
   - Codex 侧：按 keysmith `--uninstall` 回滚（详见 [docs/codex-deployment.md](docs/codex-deployment.md) §六）。

## 数据来源与许可

- 本项目自行编写的代码、DSH 适配实现及其他原创工程内容采用 **MIT License**（见 [LICENSE](LICENSE)）。
- 从 [Hzm-AI-Bot](https://github.com/MureasAm/Hzm-AI-Bot)、[persona-resound](https://github.com/MureasAm/persona-resound)、[dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) 及 [TheMasterplan](https://github.com/OasisSaber/TheMasterplan) 取得或参考的内容，继续遵循其原始许可证，并保留 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中的版权声明。
- 本仓库的 MIT License 不构成对“灰泽满 Hazel”角色、身份、名称、商标、直播内容、录音录像、原始发言或其他底层第三方知识产权的授权。
- 本项目是非官方、非商业的粉丝人格模拟项目；生成内容属于 AI 模拟结果，不代表灰泽满本人真实发表的言论，也不构成其本人、管理团队、经纪机构或其他权利人的官方授权、隶属、背书或赞助。
- 详细的人格、角色/IP 与内容权利边界见 [PERSONA-NOTICE.md](PERSONA-NOTICE.md)。

## 相关链接

- Hzm-AI-Bot: https://github.com/MureasAm/Hzm-AI-Bot
- persona-resound: https://github.com/MureasAm/persona-resound
