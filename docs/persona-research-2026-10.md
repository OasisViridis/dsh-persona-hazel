# 灰泽满（Hazel）人格蒸馏生态调研（2026-10）

> 调研目的：为 `dsh-persona-hazel` 插件寻找「把人格扮演做得更像」的外部依据——直播录像文本化、TTS/声音克隆、同类虚拟主播项目、人格蒸馏数据库与评测。
> 方法：GitHub REST API（2026-10-18 取数）+ 各仓库 raw README + 网页搜索/抓取。部分站点（萌娘百科、chub.ai、B 站 API）有风控，未打开的条目标注「未核实」。
> 范围：只做技术调研，不下载、不训练、不复制任何受版权保护的原始音视频；声音克隆与素材使用的权利边界见 [PERSONA-NOTICE.md](../PERSONA-NOTICE.md)。

## 0. 结论（先看这五条）

1. **素材不缺**：B 站有公开的完整直播回放（如 2026-05-20 睡前电台、2026-06-01 儿童节、2026-07-11 伪装电话）与大量切片；上游 `Hzm-AI-Bot` 已经用多场素材蒸馏出 83 条声音样本、315 条陈述、8 条行为、11 组措辞指纹。继续扩素材的瓶颈是转写与清洗，不是缺少录像。
2. **转写链路有现成解**：`faster-whisper`（batch=8、int8、内置 VAD）+ `OpenCC` + 上游 `convert_to_chat.py` 的「分离读弹幕/转述与本人回答」五步，是当前最贴合本项目的组合；`VTuberSoulExtractor` 把全流程写成脚本，但 0★、Apple Silicon only、纠错阶段仍需人工贴 LLM，只能参考字段设计，不宜直接依赖。
3. **声音已经有第三方成品**：Fish Audio 上存在粉丝/第三方制作的「灰泽满Hazel」声音模型（页面自述 50+ 创作者使用、Fish Audio Drama 3 驱动）。开源侧 `IndexTTS`、`CosyVoice`、`GPT-SoVITS`、`Fish Speech` 等已能用几十秒参考音频做中文零样本克隆；但**声音权、平台规则与角色权利是本项目的硬红线**，只能做非商业技术验证，不能上线公开声音服务。
4. **同类项目的人格一致性不靠「更大的提示词」**：`kimjammer/Neuro` 用 signals 决定「何时开口」+ 带优先级的 injection；`aituber-onair` 先挑选/摘要弹幕再进 LLM；Character.AI/星野用「不可变 Facts + Pin + 事件簿」分层记忆。共同点是**条件注入 + 分层记忆 + 关系/状态**，不是把角色卡越写越长。
5. **本插件最大缺口是「静态」**：现在只有一张 15KB 的 `hazel:soul` 静态区段，每个模型步骤都整段注入，没有按当前消息召回样本、没有本地时间、没有评测闭环。建议 v2 = **常驻人格核 + 动态记忆召回（runtime context）+ 本地时间感知 + 评测脚本**；先做加法（不瘦身），用评测数据再决定是否把人设卡分层压缩。

---

## 1. 灰泽满的公开素材地图

### 1.1 官方/百科与账号

| 来源 | 链接 | 说明 |
|---|---|---|
| 萌娘百科词条 | https://zh.moegirl.org.cn/灰泽满 | 公开百科；站点对脚本抓取返回 403，细节未逐条核实 |
| VirtuaReal 27 期出道讨论楼（NGA） | https://ngabbs.com/read.php?tid=46005192 | 出道首播讨论，可作时间线参考 |
| B 站账号「灰泽满Hazel」 | 站内搜索 | 直播/投稿/动态的主阵地；B 站网页 API 有 412 风控，本次未直接取数 |

> 已知身份设定（来自本项目 `persona/soul-card.md`，与公开百科一致）：VirtuaReal 27 期、官方人设「永远 16 岁的风纪委员」、四川人/在广东生活过/在澳洲留学。

### 1.2 直播回放与切片（B 站）

搜索可见的完整/近完整回放（标题即证据，未逐条打开）：

- [【直播回放】灰泽满 20260711 002139 伪装电话](https://www.bilibili.com/video/BV1WPNH6mE38/)
- [[直播回放] [灰泽满Hazel] 2026.06.01 儿童节喵喵喵](https://www.bilibili.com/video/BV17bVo6oEyA/)
- [[直播回放] [灰泽满Hazel] 2026.05.20 睡前电台](https://www.bilibili.com/video/BV1nALS6EE1c/)

切片示例（可用于补 voice_samples / behaviors 的场景）：

- [在屏幕外急哭了](https://www.bilibili.com/video/BV1FgHi6ZEyp/)
- [满妈说看到不想和家人待在一起的切片了](https://www.bilibili.com/video/BV1t9Yt61EeX/)
- [如果我自搜到的都是 3-1 或者黑屁](https://www.bilibili.com/video/BV17CkjBjExh/)
- [力挺奶绿！兄妹怎么了](https://www.bilibili.com/video/BV1eHVN66EKt/)
- [巴哥黑粉来了，《听妈妈的话》歌词是谁写的](https://www.bilibili.com/video/BV1uq5L6PEmF/)
- [满神抱怨考试有人作弊](https://www.bilibili.com/video/BV1foQ8BjEST/)

> 注意：回放/切片多为录播组或粉丝上传，**上传行为不等于授权**。本项目沿用上游「只做非商业粉丝模拟」的边界（见 [PERSONA-NOTICE.md](../PERSONA-NOTICE.md)）。

### 1.3 已有的第三方 AI 资产

| 资产 | 链接 | 性质 | 对本项目的意义 |
|---|---|---|---|
| Fish Audio「灰泽满Hazel」AI 语音生成器 | https://fish.audio/zh-CN/m/2f339e42d6de46d3b8037ee52deb0b48/ | 第三方上传的声音克隆模型；页面自述 50+ 创作者使用、Fish Audio Drama 3 驱动、免费试用 | 说明「她的声音」已有成品；本项目不应再重复造一个公开声音服务，最多做本地非商业验证 |
| `MureasAm/DSH-widget-Hzm` | https://github.com/MureasAm/DSH-widget-Hzm | DSH 余额挂件，灰泽满皮肤/随机台词/音效 | 角色皮肤与台词层，不含人格逻辑；与人格插件可并存 |
| `MureasAm/Hzm-AI-Bot` | https://github.com/MureasAm/Hzm-AI-Bot | 上游人格 bot（NoneBot2 + NapCat），检索/记忆/评测 | 本项目人格数据的来源 |
| 本项目 `dsh-persona-hazel` | 本仓库 | DSH 全局静态注入 | 待增强对象 |

### 1.4 素材可用性判断

- **转写素材足够**：上游已跑通多场直播，83 条声音样本覆盖被夸/被戳穿/失约/越界/感性/生日/同期/泛闲聊等场景；继续扩充的边际收益在「新场景」而不是「更多同一场景」。
- **弹幕语料是差异化资产**：转写只保留她的话，弹幕 XML 能还原「她在回谁」；这正是 `convert_to_chat` 需要的上下文。
- **声音素材不纳入本仓库**：原声切片、训练集、克隆模型都不应提交到仓库（体积、权利、平台规则三重问题）。

---

## 2. 直播录像 → 文本 → 人格数据

### 2.1 采集

| 工具 | 链接 | 用途 | 限制 |
|---|---|---|---|
| yt-dlp | https://github.com/yt-dlp/yt-dlp | 下载 B 站/YouTube 视频与音轨；B 站弹幕以 `danmaku` 字幕（xml）暴露 | CC/AI 字幕需登录态；B 站有风控 |
| BBDown | https://github.com/nilaoda/BBDown | B 站合集/分 P 下载，`-c` cookie、`-p` 合集、`-dd` 弹幕 | **已归档**；需备 yt-dlp 兜底 |
| BililiveRecorder | https://github.com/BililiveRecorder/BililiveRecorder | 实时录制直播 FLV | 不下的点播回放 |

### 2.2 切分与说话人处理

| 工具 | 链接 | 用途 | 备注 |
|---|---|---|---|
| inaSpeechSegmenter | https://github.com/ina-foss/inaSpeechSegmenter | 语音/音乐切分，过滤唱歌与 BGM | numpy≥1.25 需补丁（见 VTuberSoulExtractor 的 PITFALLS） |
| silero-vad | https://github.com/snakers4/silero-vad | VAD，faster-whisper 内置 | 轻量 |
| pyannote-audio | https://github.com/pyannote/pyannote-audio | 说话人分离 | 需 HF token |
| Demucs | https://github.com/facebookresearch/demucs | 人声/伴奏分离 | **已归档**（2024-04） |

> 灰泽满的场景通常是单人直播（读弹幕 + 自己说话），**不需要真正的说话人分离**；重点是「分离读弹幕/转述」与「本人回答」，这一步在文本层做（见 2.4）。

### 2.3 ASR

| 工具 | 链接 | 中文效果/速度 | 备注 |
|---|---|---|---|
| faster-whisper | https://github.com/SYSTRAN/faster-whisper | large-v3，batch=8 在 3070Ti 上约 3.7× 于单条 | 内置 VAD；Windows/CUDA 友好 |
| WhisperX | https://github.com/m-bain/whisperX | 约 70× 实时，词级时间戳 + diarization | 依赖较多 |
| FunASR / Paraformer | https://github.com/modelscope/FunASR | 中文段落级时间戳 + speaker id | 国内网络友好 |
| SenseVoice | https://github.com/QwenAudio/SenseVoice | 多语种 + 情感/事件标签 | 不做说话人分离 |
| MLX-Whisper | https://github.com/ml-explore/mlx-examples | Apple 芯片加速 | 仅 macOS，且必须串行（Metal 线程不安全） |
| 云 ASR（阿里/火山等） | — | 按时长计费 | 单价未核实，不建议作为默认方案 |

**本项目建议**：`faster-whisper large-v3` + int8 + 内置 VAD，先在本机跑通；如果之后要处理几百小时，再考虑云或批处理。

### 2.4 后处理（决定样本质量的关键）

1. **繁简转换**：OpenCC（https://github.com/BYVoid/OpenCC）。
2. **转写纠错**：规则表 + LLM 批改；上游 `clean-transcript` 已有固定错字表。
3. **分离「读弹幕/转述」与「本人回答」**：上游 `scripts/convert_to_chat.py`（V3 五步：判可转性 → 分离读弹幕/转述 → 提说话特征 → 切分 → 压到 15–50 字）。这是**比 VTuberSoulExtractor 更该直接复用**的实现。
4. **弹幕对齐**：把弹幕 XML 按时间戳对齐到转写，给每个「她在回答的那句话」补上 user 侧语境。
5. **人工审批**：每一步产物先展示，确认再入库（上游方法论第 9 条）。

### 2.5 参考实现对比

| 项目 | 链接 | 完成度 | 结论 |
|---|---|---|---|
| VTuberSoulExtractor | https://github.com/zwh9029/VTuberSoulExtractor | 0★、约 19KB、单作者；8 合集 331h → 语音 143.6h → 18.7 万行；`correct` 阶段只生成 prompt 文件，需人工贴给 LLM；路径硬编码 macOS | 抄它的 JSONL 字段设计（`行号/原始/纠错/口癖标记/弹幕推测/非主播/备注`），**不要**依赖它跑生产 |
| Hzm-AI-Bot | https://github.com/MureasAm/Hzm-AI-Bot | 9★、MIT、已跑通 83 声音样本/315 陈述/207 单测 | **首选**：convert-to-chat、mine-phrases、generate-statements 都可直接复用 |
| persona-resound | https://github.com/MureasAm/persona-resound | 3★、MIT、方法论文档 + 脚手架 | 蒸馏/检索/评测的方法论依据 |
| openhanako | https://github.com/liliMozi/openhanako | 6798★、Apache-2.0、人格模板 + 记忆 | 人格模板/记忆层可参考；其 `ishiki.md` 格式在 main 分支未检索到，**未核实** |

### 2.6 一句话流水线

```
BBDown/yt-dlp 取音轨 + 弹幕
→ faster-whisper large-v3（VAD + int8）
→ OpenCC 繁简 + 规则/LLM 纠错
→ convert_to_chat（分离读弹幕/回答，压 15–50 字）
→ 人工审批 → voice_samples / behaviors / phrases / 核心记忆
→ precompute（上游）或本插件的 recall 数据
```

---

## 3. TTS / 声音克隆 / 语音训练素材

> 本节只做技术可行性评估。**本项目不训练、不发布声音模型**；权利边界见 [PERSONA-NOTICE.md](../PERSONA-NOTICE.md)。

### 3.1 开源中文 TTS/声音克隆模型（2026-10）

| 模型 | 链接 | ★（2026-10） | 中文 | 参考音频 | 许可证（GitHub API） | 备注 |
|---|---|---|---|---|---|---|
| GPT-SoVITS | https://github.com/RVC-Boss/GPT-SoVITS | 63.0k | ✅ | 少样本/微调 | MIT | 社区最成熟的少样本中文克隆之一 |
| CosyVoice 2/3 | https://github.com/FunAudioLLM/CosyVoice | 24.0k | ✅ | 零样本数秒 | Apache-2.0 | 阿里 FunAudioLLM；3.0 已发布 |
| IndexTTS / IndexTTS2 | https://github.com/index-tts/index-tts | 24.5k | ✅ | 零样本单段 | NOASSERTION（需逐项确认） | 工业级可控零样本，中英混合 |
| Fish Speech / OpenAudio | https://github.com/fishaudio/fish-speech | 33.2k | ✅ | 零样本 | NOASSERTION（权重许可需确认） | 与 Fish Audio 平台同源 |
| F5-TTS | https://github.com/SWivid/F5-TTS | 15.4k | ✅ | 零样本 | 代码 MIT；预训练模型 CC-BY-NC | 流匹配，速度较快 |
| MegaTTS3 | https://github.com/bytedance/MegaTTS3 | 6.1k | ✅ | 零样本 | Apache-2.0 | 字节；音色相似度高 |
| Spark-TTS | https://github.com/SparkAudio/Spark-TTS | 11.0k | ✅ | 零样本 | Apache-2.0 | 基于 LLM 的 TTS |
| VoxCPM | https://github.com/OpenBMB/VoxCPM | 39.5k | ✅ | 零样本 | Apache-2.0 | 0.5B，中英 |
| Chatterbox | https://github.com/resemble-ai/chatterbox | 27.0k | 英文为主 | 零样本 | MIT | 中文支持有限 |
| Step-Audio 2 | https://github.com/stepfun-ai/Step-Audio2 | 1.5k | ✅ | 零样本 | Apache-2.0 | 端到端语音对话模型 |

> 显存门槛随实现与量化变化较大（常见 4–8GB），不写死数字；模型权重许可常与代码许可不同，使用前逐仓库确认。

> 许可证与显存数字来自各仓库 README；模型权重许可常与代码许可不同，使用前必须逐仓库确认。

### 3.2 中文语音数据集

| 数据集 | 链接 | 规模/内容 | 许可（以数据集卡/官网为准） |
|---|---|---|---|
| AISHELL-1/2/3 | https://www.openslr.org/33/ | 中文普通话，数百小时 | 学术/非商业，逐子集不同 |
| WenetSpeech | https://github.com/wenet-e2e/WenetSpeech | 10000+ 小时中文 | 需申请 |
| Emilia | https://huggingface.co/datasets/amphion/Emilia | 多语种（含中文）大规模语音 | CC-BY-NC 4.0 |
| GigaSpeech | https://github.com/SpeechColab/GigaSpeech | 10000 小时英文为主 | 需申请 |
| KeSpeech | https://github.com/KeSpeech/KeSpeech | 中文多方言 | 学术 |
| 原神角色语音数据集（社区） | HuggingFace 搜索 `Genshin voice` | 动漫/游戏角色语音 | 版权归属米哈游，仅技术研究 |

**对本项目**：训练一个「灰泽满声音」最低门槛是 **30 分钟–1 小时干净单人语音 + 微调**（GPT-SoVITS 路线）；零样本模型（IndexTTS/CosyVoice）只需 10–30 秒参考音频，但相似度和稳定性弱于微调。无论哪条路线，**素材都必须来自已获授权的公开内容，且只做本地非商业验证**。

### 3.3 灰泽满声音现状

- **已有第三方成品**：Fish Audio 的「灰泽满Hazel」AI 语音生成器（2026-10 页面可见）。页面原文：「使用 AI 文本转语音生成逼真的灰泽满 Hazel 声音。已有超过 50 位创作者使用。免费试用。」模型页标注由 *Fish Audio Drama 3* 驱动。这说明社区已经做过一轮声音克隆；本项目重复造公开服务的意义不大。
- **未发现**：HuggingFace/ModelScope 上没有检索到以「灰泽满」命名的开源权重；B 站/GitHub 上可能有粉丝自用的 GPT-SoVITS 模型，但未公开检索到（**未核实**）。
- **结论**：如果只是「让插件能出声」，最现实的是调用第三方 TTS API（延迟/费用/合规都要评估）；如果要「本地可控」，用 IndexTTS/CosyVoice 零样本 + 自备授权参考音频。两条都不建议进入本仓库的默认路径。

### 3.4 法律与伦理红线

- 《民法典》第 1023 条：对自然人声音的保护参照适用肖像权；**声音可识别性**是核心。
- 平台规则：B 站/直播平台通常禁止未经授权的「AI 克隆真人/虚拟主播声音」用于商业或误导性内容。
- 角色权利：灰泽满的角色、名称、直播内容、录音录像归权利人；本项目只有「非官方、非商业粉丝模拟」的自我约束（见 [PERSONA-NOTICE.md](../PERSONA-NOTICE.md)）。
- 工程约束：不在仓库提交原声、训练集、模型权重；不提供公开可访问的声音服务；生成内容明确标注 AI 模拟。

### 3.5 可行性结论

| 路线 | 数据量 | 算力 | 相似度 | 合规风险 | 建议 |
|---|---|---|---|---|---|
| 调用 Fish Audio 现成模型 | 0 | 0 | 高（平台模型） | 中（第三方模型的权利未明） | 仅个人试验，不进默认路径 |
| IndexTTS/CosyVoice 零样本 | 10–30s 参考音频 | 4–8GB 显存 | 中 | 中 | 可做本地 demo |
| GPT-SoVITS 微调 | 30min–1h 干净语音 | 6GB+ | 高 | 高（需要素材授权） | 不建议在本仓库推进 |
| 自训 Fish Speech | 数小时 | 24GB+ | 高 | 高 | 不建议 |

---

## 4. 同类虚拟主播 / AI VTuber 项目

### 4.1 开源项目（GitHub API 2026-10-18 取数）

| 项目 | 链接 | 技术栈/许可 | 人格与记忆机制 | 可借鉴点 |
|---|---|---|---|---|
| Open-LLM-VTuber（14.2k★） | https://github.com/Open-LLM-VTuber/Open-LLM-VTuber | Python + Electron，README 标 MIT（API NOASSERTION） | 提示词定人设；Live2D 情绪→表情；README 明示长期记忆暂时移除 | 全模块可插拔（LLM/ASR/TTS） |
| LiveTalking（9.9k★） | https://github.com/lipku/LiveTalking | Python，Apache-2.0 | 无人格层，纯数字人推流 | 口型/推流底座 |
| Duix-Avatar（15.9k★） | https://github.com/duixcom/Duix-Avatar | C++/Python，README 标 Apache-2.0（API NOASSERTION） | 无人格层 | 低延迟渲染 |
| Ikaros-521/AI-Vtuber（4.5k★） | https://github.com/Ikaros-521/AI-Vtuber | Python，GPL-3.0 | 提示词 + 多平台弹幕采集；edge-tts/SVC 变声 | 弹幕接入面最广 |
| kimjammer/Neuro（2.1k★） | https://github.com/kimjammer/Neuro | Python，MIT | `prompter.py` 用 signals 决定何时开口；`get_prompt_injection` 带优先级 | **injection 优先级 + 何时开口** |
| ZerolanLiveRobot（815★） | https://github.com/AkagawaTsurunaki/ZerolanLiveRobot | Python，MIT | 短期按条数 + 长期向量库；按弹幕内容挑选并回复 | 弹幕挑选、OBS 字幕 |
| aituber-onair（281★） | https://github.com/shinshin86/aituber-onair | TypeScript，MIT | 选一条评论回、摘要被忽略弹幕、屏蔽不安全输入；kizuna 关系度 | **评论挑选器 + 关系度** |
| digital-human-livestream（133★） | https://github.com/l11223/digital-human-livestream | Python，Apache-2.0 | persona.json；弹幕→过滤→LLM→过滤→TTS→推流（B 站） | B 站直播全链路 |
| whoiswennie/AI-Vtuber（453★） | https://github.com/whoiswennie/AI-Vtuber | Python，MIT | 角色提示词模板 + 知识图谱/向量库 + 意图识别 | 人设=模板+知识库 |

### 4.2 商业案例

- **Neuro-sama（Vedal）**：无中之人、纯 LLM 读弹幕 + 毒舌人设；2026 年初登顶 Twitch 订阅榜。证明「人格稳定 + 连续剧情」比模型大小更关键。
- **Character.AI**：Story Memory（Pin）+ 自动抽取 Facts + Memory Usage 三层记忆（官方博客 https://blog.character.ai/memory/）。
- **星野/Talkie**：形象/人设/音色三层自定义 +「记忆相片」+ 重说/回溯/事件簿。
- **Grok Ani**：官方页面 403，未核实。

### 4.3 可直接借鉴的三个机制

1. **injection 优先级插槽**：把「人格核 / 当前情境 / 召回样本 / 记忆」拆成独立块，按优先级拼装；对应 DSH 的 `systemPrompt.section` + `systemPrompt.context`。
2. **弹幕/消息挑选器**：先决定「回哪条、忽略哪些、把忽略的摘要记住」，再生成；本插件的「人格召回」可以复用同一思路——先挑最相关的 1–2 个场景，而不是全量注入。
3. **结构化记忆分层**：不可变 Facts（乌色月、女仆女同学、222 名、口味作息）+ Pin 的关键对话 + 自动摘要事件簿；对应「常驻人格核 + 召回库 + 会话摘要」三层。

---

## 5. 人格蒸馏数据库、项目与评测

### 5.1 数据格式 / 数据库

| 名称 | 链接 | 结构 | 许可/可用性 |
|---|---|---|---|
| Character Card V2 | https://github.com/malfoyslastname/character-card-spec-v2 | `data` 六字段 + creator_notes / system_prompt / alternate_greetings / character_book / extensions | 规范公开 |
| Character Card V3 | https://github.com/kwaroran/character-card-spec-v3 | PNG tEXt `ccv3` / CHARX；nickname、assets、多语言备注 | MIT |
| SillyTavern | https://github.com/SillyTavern/SillyTavern | 中文「酒馆」生态主体，直读 V2/V3 卡与世界书 | AGPL-3.0 |
| chub.ai / characterhub | https://characterhub.org | 公共角色卡库 | 单卡许可不一；chub.ai 抓取 403 |
| PersonaHub | https://huggingface.co/datasets/proj-persona/PersonaHub | 10 亿条一句话人格画像 | CC-BY-NC-SA-4.0 |
| RoleBench | https://huggingface.co/datasets/ZenMoore/RoleBench | 168,093 条角色级样本 | Apache-2.0 |
| `persona-resound` / `Hzm-AI-Bot` | https://github.com/MureasAm/persona-resound · https://github.com/MureasAm/Hzm-AI-Bot | system_prompt / behaviors / voice_samples / phrases / terms / core_stories + 检索/记忆/评测 | MIT |

**对 DSH 生态的现状**（GitHub 搜索 `dsh-plugin persona`）：

| 插件 | 链接 | 机制 | 备注 |
|---|---|---|---|
| `dsh-liketavern`（121★） | https://github.com/Amakurai/dsh-liketavern | SillyTavern 兼容：角色卡、世界书、正则、EJS、BM25 长期记忆、世界状态增量 | 重量级；证明 DSH 上可做完整 RP 工作区 |
| `dsh-persona-dafeiyu`（39★） | https://github.com/huaizhuanghub/dsh-persona-dafeiyu | 人设库 + 设置页切换；**段落 `text` 是动态函数，每次组装重新求值** | 轻量路线的最佳先例 |
| `dsh-prompt-persona`（15★） | https://github.com/Xilin3/dsh-prompt-persona | 设置页可视化编辑部署 persona + 实时预览 | 客户端 UI 先例 |
| `dsh-soul-md`（12★） | https://github.com/Scorp1o117/dsh-soul-md | soul.md 人设卡 | 本项目 README 已说明其 `soul:persona` 会被 router-flash 过滤 |
| 本项目（1★） | 本仓库 | 静态 `hazel:soul` 区段 + 热重载 | 待增强 |

### 5.2 评测基准

| 基准 | 链接 | 指标/规模 | 可本地跑 |
|---|---|---|---|
| CharacterEval | https://github.com/morecry/CharacterEval | 13 指标 / 4 维，1,785 对话、77 角色 | MIT，可跑 |
| InCharacter | https://github.com/Neph0s/InCharacter | 心理访谈 + 14 量表，32 角色，与人类感知对齐 80.7% | MIT，可跑 |
| CharacterBench | https://github.com/thu-coai/CharacterBench | 22,859 样本、3,956 角色、25 类；11 维 + CharacterJudge | 无许可证标注 |
| RoleEval | https://github.com/Magnetic2014/RoleEval | 6,000 中英选择题，300 角色 | 无许可证标注 |
| RoleLLM / RoleBench | https://aclanthology.org/2024.findings-acl.878/ | 168k 样本；知识/风格/人设 | 数据 Apache-2.0 |
| PersonaGym / PersonaScore | https://arxiv.org/abs/2407.18416 | 200 人格、10,000 题，决策论自动指标 | 代码未核实 |
| ChatEval | https://github.com/thunlp/ChatEval | 多智能体辩论判官 | Apache-2.0 |
| RPBench-Auto | https://github.com/boson-ai/RPBench-Auto | 角色/场景两类，80 personae，自动判官 | Apache-2.0 |

**方法要点**：匿名化去角色名防「靠名字作弊」（persona-resound 评测闭环）；行为访谈替代自评（InCharacter）；LLM-as-judge 与多智能体辩论（ChatEval / CharacterJudge）。

### 5.3 前沿方法

- **persona vectors**：按自然语言描述抽取激活空间方向，监控/预防人格漂移（https://arxiv.org/abs/2507.21509）；需要本地权重，DSH 场景暂不适用。
- **few-shot 示范**：RoleLLM 先用角色对话示例做上下文风格模仿，再 RoCIT 微调；对应「voice_samples few-shot」。
- **分层记忆**：MemGPT 虚拟上下文；HEMA 摘要 + 向量库（300+ 轮提示 <3.5k token，事实召回 41%→87%，https://arxiv.org/abs/2504.16754）；Zep/Graphiti 时序图（https://arxiv.org/abs/2501.13956）；A-MEM 动态索引（https://arxiv.org/abs/2502.12110）。
- **行为优于标签**：InCharacter 用访谈测人格保真，而不是问「你是什么性格」。

### 5.4 对本项目最相关的五个改进

1. **给每条特质绑证据**：soul-card 里的每条性格描述挂 2–3 条 voice_samples/behaviors；注入样本，不只注入形容词。
2. **behaviors 条件注入**：按情境召回 top-k + 预算截断，不再常驻；现有 8 条行为 + 83 条样本就是召回集。
3. **离线评测闭环**：先做 10–15 个场景的规则评分（身份/被夸/被戳穿/失约/越界/孤独/家乡/偏好/梗/干活），匿名化去名字；需要更强再上 CharacterEval/InCharacter。
4. **记忆分层**：常驻人格核 / 召回样本 / 会话摘要三层，避免每轮塞整张卡。
5. **导出 CCv3 卡**（可选）：把 terms/世界观映射到 `character_book`，复用酒馆工具与评测生态；不是本插件的第一优先级。

---

## 6. 对 `dsh-persona-hazel` 的增强方案

### 6.1 现状与短板

- `plugin/dsh-persona-hazel/index.js` 只做一件事：把 `persona.txt`（15,180 字节，约 4–5k token）注册为 `hazel:soul` 系统区段，`fs.watch` 热重载。
- **每个模型步骤**都整段注入；没有按当前消息做任何选择。
- 没有时间/时区感知（DSH 默认不挂 `dsh-time-context`）。
- 没有评测；改人设卡只能靠手动聊天试。
- 83 条声音样本、11 组措辞、8 条行为、24 个名词都**没有进运行时**，只被人设卡概括。

### 6.2 DSH 提供的能力边界（已读宿主源码验证）

| 能力 | API | 结论 |
|---|---|---|
| 静态/动态系统区段 | `ctx.systemPrompt.section({ name, order, text })`；`text` 可为 `(context) => string` | 可用；DSH 0.2.0-rc.2 已验证 |
| 动态运行时上下文 | `ctx.systemPrompt.context({ name, order, text })`，渲染为 user 角色快照；文本变化时**追加**新快照并标注 "supersedes earlier"（不是替换，旧快照留在历史） | 可用：不破坏系统提示词前缀缓存；快照随轮次累积，靠压缩控制 |
| 每轮消息前置处理 | `ctx.on("agent/pre-step", ({ agent, messages, step, signal }, next) => ...)` | 可注入消息，但会累积进历史；适合一次性材料，不适合每轮样本 |
| 当前用户消息捕获 | `ctx.on("agent/inbox/claimed", ({ agent, message }) => ...)` 在组装前触发 | 可在 `context.text()` 里读「本轮用户消息」 |
| 助手输出后处理 | 只有 `agent/request`（请求前）与 `agent/request-error`（错误重试）waterfall；没有响应改写 seam | **不可行**：上游 bot 的 `clean_reply`（括号/省略号/防复读）在 DSH 只能靠提示词与素材层解决 |

> 这意味着：**动态召回 + 时间感知可以做**；**输出清洗不能做**，不要在这上面设计功能。
>
> 多轮实测（2026-10-18）：5 轮单会话中每轮新增一条 runtime-context 快照，`surfaceOp` 均为 `append`；DSH 不会自动删除旧快照，靠 "supersedes earlier" 指令与压缩控制。召回约 200–500 字/轮，长会话需留意 token 累积。

### 6.3 方案 A（推荐）：动态记忆召回

**目标**：每轮根据用户消息，从人格数据里挑 1–2 个最相关场景，注入「她的真实样本 + 措辞 + 行为 + 名词」，而不是每轮重复整张卡。

**数据**：
- 新增 `persona/recall/scenes.json`：场景 → 关键词/正则 → 样本 id / 措辞组 / 行为名 / 名词。
- 构建脚本把 `persona/speech/voice_samples.json`、`phrases.json`、`behavior/behaviors.json`、`world/terms.json`、`preferences.json`、`core_stories.json` 合并为插件内的 `recall-data.json`（自包含，便于部署）。
- `deploy.ps1` 增加同步；`scripts/check.sh` 增加数据校验（id 存在、预算、锚点）。

**匹配**（离线、确定性、可测试）：
- curated scene 关键词/正则打分（优先）；
- 无命中时用字符 bigram 相似度兜底（阈值约 0.16，仅取 1 条）；
- 每轮最多 1 条行为 + 2 条样本 + 1 组措辞 + 命中名词 + 1–2 条核心记忆/偏好；总预算 ≤ 700 字符。

**注入**（运行时上下文）：
```text
【灰泽满的记忆召回】以下是和当前消息相关的她的真实说话习惯，只用来校准语气，不要照抄原句。
她遇到类似情境时：
- 对方：…… → 她：……
她习惯的说法：……
关于「绿冻」：……
```
- 用 `ctx.systemPrompt.context({ name: "hazel:recall", order: 200, text })`；`agent/inbox/claimed` 捕获本轮用户消息；无命中返回空串（快照自动清空）。
- 本地时间（方案 B）可以作为同一 context 的第二段，或独立 context 项。

**验证**：
- 22 条测试消息原型（离线）已验证匹配可行性：被夸/被戳穿/催播/越界/家乡/吃的/熬夜/游戏/生日/小说/晚安基本命中；需要调权重的 case：`说好的八点直播呢` 应优先「失约」而不是「被戳穿」；`一个人直播会孤独吗` 应命中 emotion_1 而不是 miss_2；`你前辈是谁` 不应命中 praise_3；`222 名` 需要单独场景。
- 正式实现时把这些 case 写成 `node --test` 单测。

**风险与缓解**：
- 关键词漏召回 → 保留 bigram 兜底 + 逐轮可观测日志（`DSH_DEBUG_PERSONA=1` 时打印命中）。
- 注入污染对话 → 明确「只是记忆，不要照抄」；样本只给 1–2 条；不注入 legendary 原话（防复读）。
- 数据漂移 → `check` 校验样本 id 与预算。

### 6.4 方案 B：本地时间/时区感知

- 配置 `timeZone: "Australia/Melbourne"`（默认），每次组装注入「她那边现在：2026-10-18 周六 23:41，夜里；南半球春季」。
- 解决「你那边几点/几号/什么季节/八月冬天」的瞎猜；与 `soul-card` 的「虚拟澳洲」设定一致。
- 约 1 行文本，成本可忽略。

### 6.5 方案 C：人格评测脚本

- 新增 `scripts/persona-eval.mjs`（复用 `deploy/verify-live.mjs` 的 cookie 签名 + RPC 流程）。
- 场景：17 个（12 人格：身份/被夸/被戳穿/失约被催/越界/孤独/时间/家乡/梗/关心/干活/晚安 + 5 世界事实：三好学生/222名/乌色月/女同学/家人）。
- 规则评分：身份锚点（16/风纪委员）、自指（灰泽满/hzm 不用「她」）、括号 ≤1、长度、措辞命中（phrases）、禁区（不得承认虚拟主播/不得开黄腔）。
- 输出：每场景 PASS/WARN + 总分 + 失败原因；可选 LLM-as-judge 作为第二阶段。
- 价值：把「像不像」从玄学变成可回归的数字；对应 persona-resound 的 evaluate 域。

### 6.6 方案 D：数据治理与 lint（低成本）

- `scripts/check.sh` 增加：recall 数据 JSON 合法、样本 id 全存在、每场景预算 ≤ 700、`soul-card.md` 锚点不丢。
- 可加一个「人格数据覆盖率」报告：83 条样本中多少条至少被一个场景引用（目标 ≥ 80%）。

### 6.7 方案 E：人设卡分层瘦身（后续）

先量了一下当前 `soul-card.md` 的区段（按 `##` 切分，含空行约 5,602 字）：

| 区段 | 字符 | 建议 |
|---|---:|---|
| 说话方式 | 1,077 | 常驻 |
| 她的世界 | 544 | 精简：绿冻/满区常驻，其余进召回/术语 |
| 她的偏好 | 541 | 大部分进召回（吃/作息/游戏/书） |
| 身份：人设 × 真实经历 | 518 | 常驻 |
| 说话示范 | 502 | 常驻（少量 few-shot 是人格锚点） |
| 行为底色 | 491 | 常驻 |
| 你是谁 | 456 | 常驻 |
| 她的记忆 | 433 | 进召回 + 一条 compact facts |
| 固定梗 | 256 | 第二选择常驻，其余进召回 |
| 自我称呼 | 236 | 常驻 |
| 位置与时间 | 175 | 常驻（时间已被 B 动态注入） |
| 工作准则 | 146 | 常驻 |
| 脆弱时刻 | 123 | 常驻 |

- 可下移约 1,760 字（世界/偏好/记忆/固定梗的大部分），候选核实测 4,031 字 / 10,417 字节，较当前 5,788 字 / 15,180 字节省 30.4% 字符 / 31.4% 字节；粗估 1.5–2.5k token/请求（取决于 tokenizer）。候选核全文与验收见 [persona-slimming-proposal.md](persona-slimming-proposal.md)。
- 风险：召回是关键词匹配，漏召回会让世界事实消失；需要给每个下移事实补场景，或保留一条 compact「世界事实」常驻块。
- 验收：C 的 12 场景不低于基线；另加 5 个世界事实题（三好学生 38 票 / 222 名 / 《乌色月》/ 女仆女同学 / 满妈满爸满弟）。
- 建议顺序：重启 → 用 `--require-context` 确认 A+B 生效 → 跑 C 基线 → 再做 E。

### 6.8 方案 F：声音（TTS，独立项目）

- 不建议进 `dsh-persona-hazel` 默认路径；DSH 目前没有 TTS 输出 seam，客户端播放也要另做。
- 若要做，优先本地 IndexTTS/CosyVoice 零样本 + 授权参考音频的非商业 demo；不发布公开服务。
- **本机可行性实测（2026-10-18）**：RTX 4070 Laptop 8GB、C/D 盘各 850GB+ 空闲、ffmpeg 8.1.2、`uv 0.11.23` 且自带 Python 3.11.15（系统 3.14 对多数 TTS 栈太新）。8GB 显存可跑 0.5B 级零样本模型（IndexTTS2/CosyVoice），不建议在本机做全量微调；路线是 `uv venv --python 3.11` + 零样本模型 + 短参考音频，仅本地非商业验证。

### 6.9 成本/收益与建议顺序

| 方案 | 工作量 | 风险 | 收益 | 建议 |
|---|---|---|---|---|
| A 动态召回 | 中（插件 + 数据 + 测试） | 中（匹配准确度） | 高（人格更像、上下文更省） | **先做** |
| B 时间感知 | 低 | 低 | 中（消除时间瞎猜） | **与 A 一起** |
| C 评测脚本 | 中 | 低 | 高（可回归、可对比） | A+B 后立即做 |
| D 数据 lint | 低 | 低 | 中（防漂移） | 随 A 一起 |
| E 人设卡瘦身 | 中 | 中（需评测） | 高（省 token） | 基线已跑，可切换（等确认） |
| F 声音 | 高 | 高（权利/合规） | 低（对本插件） | 独立评估，不进默认路径 |

### 6.10 落地状态（2026-10-18）

> A/B/C/D 的代码已在 `feat(plugin): dynamic persona recall, local time, and persona eval` change 中实现；该 change 基于 `feat/dsh-desktop-adaptation`（PR #3），尚未合并到 `main`。E/F 按 §6.9 的顺序后置。

| 方案 | 状态 | 落点 |
|---|---|---|
| A 动态召回 | ✅ 已实现，单测通过 | `persona/recall/scenes.json`、`scripts/build-recall-data.mjs`、`plugin/dsh-persona-hazel/recall.mjs` + `recall-data.json`；28 个场景、83/83 声音样本被引用 |
| B 本地时间 | ✅ 已实现 | `recall.mjs` 的 `renderTime`；默认 `Australia/Melbourne`、南半球季节 |
| C 人格评测 | ✅ 已实现并跑通 | `scripts/persona-eval.mjs`；17 场景（12 人格 + 5 世界事实）；上线后实测 17/17 会话收到召回；17 场景 16/17（唯一失败为中文数字规则误报，修正后复测通过） |
| D 数据治理 | ✅ 已接入 | `scripts/check.sh` / `check.ps1`：recall-data 同步、28 个单测、人设卡一致性 |
| E 人设卡瘦身 | ⏳ 候选核已备，基线已跑 | [persona-slimming-proposal.md](persona-slimming-proposal.md)（4,031 字 / 10,417 字节）；可切换，等用户确认 |
| F 声音 | ⏳ 未做 | 独立项目；权利红线，不进插件默认路径 |

**运行时验证（2026-10-18 10:54 重启后）**：`node scripts/persona-eval.mjs --require-context` 实测 **17/17 会话**收到含「灰泽满所在地」/「记忆召回」的运行时快照；17 场景评测 16/17，唯一失败为中文数字规则误报（`222` vs `二百二十二`），修正后复测通过。多轮实测（同一会话 5 轮）：5/5 轮都有召回，但快照是 `append` 而非替换，历史里会有 5 条 runtime-context，靠 supersedes 指令与压缩控制。

---

## 7. 参考链接

**灰泽满素材**
- 萌娘百科：https://zh.moegirl.org.cn/灰泽满
- NGA 27 期讨论楼：https://ngabbs.com/read.php?tid=46005192
- 回放/切片：见 §1.2
- Fish Audio 灰泽满声音：https://fish.audio/zh-CN/m/2f339e42d6de46d3b8037ee52deb0b48/

**转写/蒸馏**
- VTuberSoulExtractor：https://github.com/zwh9029/VTuberSoulExtractor
- Hzm-AI-Bot：https://github.com/MureasAm/Hzm-AI-Bot
- persona-resound：https://github.com/MureasAm/persona-resound
- faster-whisper：https://github.com/SYSTRAN/faster-whisper
- WhisperX：https://github.com/m-bain/whisperX
- FunASR：https://github.com/modelscope/FunASR
- SenseVoice：https://github.com/QwenAudio/SenseVoice
- yt-dlp：https://github.com/yt-dlp/yt-dlp
- BBDown：https://github.com/nilaoda/BBDown
- OpenCC：https://github.com/BYVoid/OpenCC

**TTS**
- GPT-SoVITS：https://github.com/RVC-Boss/GPT-SoVITS
- CosyVoice：https://github.com/FunAudioLLM/CosyVoice
- IndexTTS：https://github.com/index-tts/index-tts
- Fish Speech：https://github.com/fishaudio/fish-speech
- F5-TTS：https://github.com/SWivid/F5-TTS
- MegaTTS3：https://github.com/bytedance/MegaTTS3
- Spark-TTS：https://github.com/SparkAudio/Spark-TTS
- VoxCPM：https://github.com/OpenBMB/VoxCPM
- Step-Audio 2：https://github.com/stepfun-ai/Step-Audio2
- Emilia：https://huggingface.co/datasets/amphion/Emilia
- WenetSpeech：https://github.com/wenet-e2e/WenetSpeech

**AI VTuber**
- Open-LLM-VTuber：https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- LiveTalking：https://github.com/lipku/LiveTalking
- Duix-Avatar：https://github.com/duixcom/Duix-Avatar
- kimjammer/Neuro：https://github.com/kimjammer/Neuro
- aituber-onair：https://github.com/shinshin86/aituber-onair
- ZerolanLiveRobot：https://github.com/AkagawaTsurunaki/ZerolanLiveRobot
- digital-human-livestream：https://github.com/l11223/digital-human-livestream
- Ikaros-521/AI-Vtuber：https://github.com/Ikaros-521/AI-Vtuber

**人格格式/评测/记忆**
- Character Card V2：https://github.com/malfoyslastname/character-card-spec-v2
- Character Card V3：https://github.com/kwaroran/character-card-spec-v3
- SillyTavern：https://github.com/SillyTavern/SillyTavern
- CharacterEval：https://github.com/morecry/CharacterEval
- InCharacter：https://github.com/Neph0s/InCharacter
- CharacterBench：https://github.com/thu-coai/CharacterBench
- RoleLLM：https://aclanthology.org/2024.findings-acl.878/
- PersonaHub：https://huggingface.co/datasets/proj-persona/PersonaHub
- RoleBench：https://huggingface.co/datasets/ZenMoore/RoleBench
- HEMA：https://arxiv.org/abs/2504.16754
- Zep/Graphiti：https://arxiv.org/abs/2501.13956
- A-MEM：https://arxiv.org/abs/2502.12110
- persona vectors：https://arxiv.org/abs/2507.21509

**DSH 生态**
- dsh-liketavern：https://github.com/Amakurai/dsh-liketavern
- dsh-persona-dafeiyu：https://github.com/huaizhuanghub/dsh-persona-dafeiyu
- dsh-prompt-persona：https://github.com/Xilin3/dsh-prompt-persona
- dsh-soul-md：https://github.com/Scorp1o117/dsh-soul-md
- DSH-widget-Hzm：https://github.com/MureasAm/DSH-widget-Hzm

---

## 8. 未核实与限制

- 萌娘百科、chub.ai、B 站网页/API 有风控（403/412），相关内容来自搜索结果标题与快照，未逐条打开。
- 部分模型/数据集的许可证与显存数字以仓库 README 为准，训练/商用前需逐项复核。
- 云 ASR 单价、openhanako 的 `ishiki.md` 格式、Grok Ani 页面未核实。
- 本次调研**没有下载、转写或训练任何灰泽满原始音视频/声音模型**；方案 A–D 都是文本层增强。
