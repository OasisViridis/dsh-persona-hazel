# 文档索引

本目录只放**当前仓库**（HazePersona：人格蒸馏数据 + `dsh-persona-hazel` 插件 + Codex 全局指令）的文档。
上游 QQ bot 工程的原文归档在 [`upstream/`](upstream/)，读的时候注意别把它当成这个仓库的事实。

## 当前仓库

| 文档 | 讲什么 |
|---|---|
| [codex-deployment.md](codex-deployment.md) | 用 codex-keysmith 把 `persona/soul-card.md` 部署成 Windows Codex 全局指令：机制、回滚、沙箱实测、红线 |
| [handoff-codex-deploy-20260821.md](handoff-codex-deploy-20260821.md) | 上面那次部署的任务书与验收记录（历史存档） |
| [persona-research-2026-10.md](persona-research-2026-10.md) | 人格蒸馏生态调研：素材、转写、TTS、同类项目、评测；§6 是插件 A–I 方案的落地状态 |
| [persona-slimming-proposal.md](persona-slimming-proposal.md) | E 方案：人设卡分层瘦身的候选核与验收记录 |
| [adr/0001-two-clock-date-anchor.md](adr/0001-two-clock-date-anchor.md) | I 方案：双时钟日期锚点，相对日期与排期按宿主时间，她的当地日期只用于她自己的作息 |
| [voice-prototype.md](voice-prototype.md) | F 方案：本地 F5-TTS 零样本链路验证（不是她的音色） |
| [voice-training-data.md](voice-training-data.md) | F 方案配套：THCHS-30 训练音频的获取与清单（Apache-2.0，通用普通话） |

## 上游归档

| 文件 | 注意 |
|---|---|
| [upstream/README.md](upstream/README.md) | [Hzm-AI-Bot](https://github.com/MureasAm/Hzm-AI-Bot) 原 README：NoneBot2 + NapCat 的 QQ bot 工程 |
| [upstream/ROADMAP.md](upstream/ROADMAP.md) | 上游重构历程 V1–V5.5、方法论与踩坑记录——**方法论部分仍然适用**，工程结构与文件路径不适用 |

> 上游文档里出现的 `bot.py`、`src/plugins/chatbot/`、207 个单测、NoneBot2 运行时，都属于 QQ bot 工程，**不在本仓库**。
> 本仓库只保留它蒸馏出来的人格数据（`persona/`），以及 DSH / Codex 两侧的部署实现。
> 想复现「检索注入 + 记忆系统 + 行为 L3」那一套，去上游仓库，别在这里找。

## 该读哪份

- **我要改人设卡** → 根目录 [README.md](../README.md) 的「修改流程」，再看 [DSH-WORKSPACE.md](../DSH-WORKSPACE.md)
- **我要改召回场景/关键词** → `persona/recall/scenes.json`，然后跑 `node scripts/recall-eval.mjs`（标注集：`persona/recall/eval-set.json`）
- **我要知道某个方案做到哪一步了** → [persona-research-2026-10.md](persona-research-2026-10.md) §6.10 的落地状态表
- **我要接 Codex** → [codex-deployment.md](codex-deployment.md)，跑完用 `node scripts/cross-surface-check.mjs` 确认两端一致