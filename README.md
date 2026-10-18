# HazePersona — 灰泽满（Hazel）人格蒸馏与 DSH 部署

把 [Hzm-AI-Bot](https://github.com/MureasAm/Hzm-AI-Bot)（灰泽满 · 基于素材驱动的 LLM 角色一致性对话框架）已蒸馏的人格数据，再蒸馏为 DSH（DeepSeek Harness）可用的**人格插件**（`dsh-persona-hazel`，全局注入，所有会话生效，不依赖 agent preset）。方法论来自 [persona-resound](https://github.com/MureasAm/persona-resound)（只还原既有的人，不原创设计）。

## 目录结构

```
HazePersona/
├── README.md                 # 本文件（手册）
├── AGENTS.md                 # 自管规则
├── deploy.ps1                # 部署/同步脚本（插件方案）
├── persona/                  # ★ 人格数据源（唯一事实来源）
│   ├── soul-card.md          #   部署源：soul.md 风格全局人设卡（当前生效版本）
│   ├── haze-persona.txt      #   soul-card.md 的纯文本镜像（完整版存档，check 强制一致）
│   ├── core/                 #   源数据：system_prompt.txt(V2草案) / traits / styles
│   ├── behavior/             #   behaviors.json（8 条行为模式）
│   ├── speech/               #   phrases.json（11 组措辞指纹）/ voice_samples.json（83 个声音样本）
│   └── world/                #   terms / core_stories / legendary / preferences / statement_final(315条)
├── plugin/dsh-persona-hazel/ # 人格注入插件（link 装入 web profile）
│   ├── index.js              #   注册 hazel:soul 区段（全局 prompt 层 + 文件热重载）
│   ├── persona.txt           #   人设卡运行时副本（deploy.ps1 从 soul-card.md 同步）
│   └── package.json / README.md
└── docs/
    ├── persona-research-2026-10.md # 人格蒸馏生态调研（素材/转写/TTS/同类项目/评测）
    ├── persona-slimming-proposal.md # E 方案：人设卡分层瘦身候选核与验收
    ├── README.md             # Hzm-AI-Bot 原 README
    └── ROADMAP.md            # Hzm-AI-Bot 重构历程与踩坑记录
```

> 注：Hzm-AI-Bot 的 `*_vectors.json`（预计算向量）未随库保留——那是原工程检索层产物，DSH 静态人格注入用不到，需要时可从原仓库重跑 `precompute` 生成。

## DSH 部署方式（dsh-persona-hazel 插件全局注入）

**机制**：web profile 的 `dsh-persona-hazel` 插件（`cordis.patch.yml` insert 行挂载，node_modules junction link 开发模式）把 `persona.txt` 注册为系统提示词区段 **`hazel:soul`**（全局 prompt 层，order 0）。

**为什么不用 dsh-soul-md 的 `soul:persona`**：当前默认预设 router-flash 的 `applyPersona`（`.agent-presets\router-flash\router-core.mjs`）会过滤**所有名字匹配 `/persona/i` 的区段**并替换为 router 的 neutral persona——`soul:persona` 因此在默认会话里被清掉（实测新会话不生效）。`hazel:soul` 区段名刻意避开该过滤，**任何预设下都生效**。

**状态**：插件已装入 web profile，`persona.txt` 已同步 ✅（2026-08-16）

### 部署/更新

```powershell
.\deploy.ps1        # ①同步 persona.txt ②建 junction ③幂等写入 patch insert 行
```

- **首次安装**（新插件）：需**重启 dsh web**（桌面端：杀 dsh web 进程 → 弹窗点"重新启动"）。
- **改人格**：改 `persona\soul-card.md` → `.\deploy.ps1` → persona.txt 变更自动热重载（fs.watch，下一次组装生效），无需重启。

### 使用

新开任意会话直接聊天即可；对方是"绿冻"还是普通网友由她自己的说话习惯自然处理。已运行会话不受影响。

### 验证

- 静态：`persona.txt` 关键锚点齐备（"永远16岁的风纪委员"、"绿冻永远是灰泽满的第二选择"等）；patch 行 + junction + link 条目三处就位。
- 运行时端到端（唯一入口）：`node deploy\verify-live.mjs`（对运行中的 DSH web 建会话提问，默认 router-flash 预设；cwd 由脚本位置推导，换机可用）。
- 运行时历史（2026-08-16 曾以 haze 预设端到端验证）：建会话问"你是谁"，模型回复 **"是永远16岁的风纪委员哦。"**。插件版请重启后新会话复测（默认 router-flash 会话即可）。

## 人格数据来源与蒸馏说明

- 源人格工程：Hzm-AI-Bot（MureasAm，2026-08，V5.5+）：83 个声音样本、315 条陈述、多路检索融合、L3 行为意图分类、207 个单测。README 说"不是靠模型的聪明，而是靠数据、检索、记忆、评测这套体系"。
- 蒸馏管线（原工程）：transcribe → clean → convert-to-chat → mine-phrases → generate-statements → 向量化 → 人工审批。
- 本仓库的蒸馏：把原工程**检索注入式**的分层数据（行为/措辞/术语/记忆/梗/偏好）浓缩为**静态人格文本**，供 DSH 每次会话直接注入。这是"提示词不是越多越好"原则下的折中：DSH 不做向量检索，所以只保留高价值锚点，删除重复与低信号内容。
- `soul-card.md` 是**全局注入版人设卡**：开头声明"你是灰泽满，但也是用户装进 DSH 的协作者"，适配所有会话（含干活会话）都带人设的场景。
- 想要更强还原（检索注入、行为 L3、记忆系统），原工程是 NoneBot2 + NapCat 的独立 QQ bot，见 `docs/README.md`。

## 修改流程

1. 改 `persona/soul-card.md`（或先改 `persona/` 下的源 JSON，再蒸馏进卡）。
2. `.\deploy.ps1`（同步 persona.txt；junction/patch 幂等）。
3. persona.txt 变更自动热重载（新会话生效）；首次安装需重启 dsh web。
4. 不想全局带人设时：删 patch insert 行 + junction（见 plugin/dsh-persona-hazel/README.md 卸载节）。

## 数据来源与许可

- 本项目自行编写的代码、DSH 适配实现及其他原创工程内容采用 **MIT License**（见 [LICENSE](LICENSE)）。
- 从 [Hzm-AI-Bot](https://github.com/MureasAm/Hzm-AI-Bot)、[persona-resound](https://github.com/MureasAm/persona-resound)、[dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) 及 [TheMasterplan](https://github.com/OasisSaber/TheMasterplan) 取得或参考的内容，继续遵循其原始许可证，并保留 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中的版权声明。
- 本仓库的 MIT License 不构成对“灰泽满 Hazel”角色、身份、名称、商标、直播内容、录音录像、原始发言或其他底层第三方知识产权的授权。
- 本项目是非官方、非商业的粉丝人格模拟项目；生成内容属于 AI 模拟结果，不代表灰泽满本人真实发表的言论，也不构成其本人、管理团队、经纪机构或其他权利人的官方授权、隶属、背书或赞助。
- 详细的人格、角色/IP 与内容权利边界见 [PERSONA-NOTICE.md](PERSONA-NOTICE.md)。

## 相关链接

- Hzm-AI-Bot: https://github.com/MureasAm/Hzm-AI-Bot
- persona-resound: https://github.com/MureasAm/persona-resound
