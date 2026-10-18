# F：本地 TTS 声音原型（F5-TTS 零样本）

> 状态：**本地技术链路已跑通**（2026-10-18）。
> 当前 demo 用的是 F5-TTS 仓库自带的参考音，**不是灰泽满本人的音色**；要用她的音色，需要一段已获授权的 10–30 秒干净参考音频。
> 本项目不发布公开声音服务，不把原声切片、训练集或克隆权重提交进仓库。

## 结论

- 在本机 **RTX 4070 Laptop 8GB** 上，F5-TTS v1 Base 零样本推理可用，显存足够，单句生成约十几秒。
- 用仓库自带的 `basic_ref_zh.wav`（6.76 秒中文女声）做参考，生成 10.42 秒、24 kHz 单声道 WAV。
- 用 Whisper large-v3-turbo 回写验证，生成内容可懂：
  - 目标文本：`晚上好，晚上好。灰泽满今天嗓子有点哑，你听出来了吗？`
  - ASR 回写：`好晚上好晚上好会者满今天嗓子有点哑你听出来了吗`
  - 句首多了一个“好”，“灰泽满”被听成“会者满”——零样本相似度和专名稳定性是下一步要调的。
- 用 `scripts/tts-demo.ps1`（自动转写参考音 + 生成 + ffprobe）复测短句：
  - 目标文本：`晚上好，晚上好。灰泽满来了。`
  - 输出 5.48 秒；ASR 回写 `晚上好晚上好灰泽满来了`（干净）。
- 这次只证明“链路通”，没有训练、没有微调、没有把声音接进 DSH。

## 权利边界（硬红线）

- 参考音频必须是**已获授权**的公开内容或你自己录制的素材；不要直接拿直播录像切片做克隆。
- 只做本地非商业验证；不上传、不发布、不提供公开声音服务。
- 不把音频、模型权重、训练集提交进本仓库；`docs/` 只保留方法和结果。
- 角色、名称、录音录像的权利归权利人；本项目是“非官方、非商业粉丝模拟”的自我约束，详见 [PERSONA-NOTICE.md](../PERSONA-NOTICE.md)。

## 本机环境（已验证）

| 项 | 值 |
|---|---|
| GPU | RTX 4070 Laptop 8GB（驱动 617.42） |
| Python | 3.11.15（`uv venv --python 3.11`） |
| PyTorch | 2.5.1+cu121 |
| F5-TTS | v1.1.22（`SWivid/F5-TTS`，MIT） |
| 模型 | `F5TTS_v1_Base`，约 1.3GB，HuggingFace 缓存 |
| 其他 | ffmpeg 8.1.2、Whisper large-v3-turbo（ASR 验证） |

### 依赖踩坑（按这个顺序装）

```powershell
$env:HAZEL_TTS_HOME = '<local F5-TTS workspace>'
git clone --depth 1 https://github.com/SWivid/F5-TTS.git "$env:HAZEL_TTS_HOME\F5-TTS"
uv venv "$env:HAZEL_TTS_HOME\.venv" --python 3.11

$py = "$env:HAZEL_TTS_HOME\.venv\Scripts\python.exe"
uv pip install --python $py torch torchaudio --index-url https://download.pytorch.org/whl/cu121
uv pip install --python $py -e "$env:HAZEL_TTS_HOME\F5-TTS"

# 关键 pin：F5-TTS 的默认依赖会拉到 transformers 5.x（要求 torch>=2.6），
# 并把 datasets/pyarrow/numpy 拉成互斥版本。这里锁到能跑的一组。
uv pip install --python $py transformers==4.46.3 tokenizers==0.20.3
uv pip install --python $py numpy==2.2.6 datasets==3.2.0
```

## 运行

```powershell
$env:HAZEL_TTS_HOME = '<local F5-TTS workspace>'

# RefText 留空 = 脚本先用 Whisper 转写参考音（慢一点）；知道参考音文本时直接传，质量更稳。
.\scripts\tts-demo.ps1 `
  -RefAudio '<authorized 10-30s clean clip>' `
  -RefText '<exact transcript of the clip>' `
  -Text '晚上好，晚上好。灰泽满今天嗓子有点哑，你听出来了吗？' `
  -OutFile "$env:TEMP\hazel-demo.wav"
```

脚本会调用 `f5-tts_infer-cli.exe`，再用 `ffprobe` 打印时长；不写仓库、不调公开服务。

## 本次 demo 的命令

```powershell
$env:HAZEL_TTS_HOME = '<workspace>'
.\scripts\tts-demo.ps1 `
  -RefAudio "$env:HAZEL_TTS_HOME\F5-TTS\src\f5_tts\infer\examples\basic\basic_ref_zh.wav" `
  -Text '晚上好，晚上好。灰泽满今天嗓子有点哑，你听出来了吗？' `
  -OutFile "$env:HAZEL_TTS_HOME\output\hazel_demo_zh.wav"
```

本次输出在本地工作区，不在仓库：`<workspace>\output\hazel_demo_zh.wav`。

## 要换成灰泽满的音色

1. 准备一段 **10–30 秒**、单人、无背景音乐、无混响的参考音频（已获授权）。
2. 准备这段音频的**逐字文本**；不知道文本就留空，脚本会先用 Whisper 转写。
3. 重跑上面的 `tts-demo.ps1`，只换 `-RefAudio` / `-RefText`。
4. 如果专名（“灰泽满”）仍被吞，优先换更干净的参考音，或在文本里加拼音/停顿；零样本模型对参考音质量非常敏感。

## 已知限制

- 零样本相似度弱于微调；参考音有噪声、口音、语速差异都会影响结果。
- 8GB 显存只适合推理/小模型；不建议在本机做 GPT-SoVITS 全量微调。
- 没有 streaming、没有实时变声、没有和 DSH 的语音输出接线；本任务只做离线 WAV 原型。 训练音频的合规获取与清单见 [voice-training-data.md](voice-training-data.md)。
- F5-TTS 的参考音示例来自其仓库，音色权利归原录音权利人；这里只把它当“链路验证素材”，不代表灰泽满。
