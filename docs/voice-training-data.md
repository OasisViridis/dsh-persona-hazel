# F 训练音频：THCHS-30（Apache-2.0，普通话，约 34 小时）

> 目的：给本地 TTS 训练/微调准备一份**许可证明确**的普通话语音数据。
> 这不是灰泽满的声音，也不能拿来冒充她；灰泽满本人音色仍需权利人授权。

## 为什么选 THCHS-30

- **许可证**：Apache License 2.0（OpenSLR 18 页面明确标注），允许使用、修改、分发，包含商业使用；保留版权与许可声明即可。
- **规模**：约 30 小时普通话朗读，单人/多说话人，16 kHz WAV + 对应文本，足够做 TTS 微调或训练管线验证。
- **获取**：OpenSLR 公开下载，无需注册；ELDA 镜像比主站快。
- **不选**：Primewords 是 **CC BY-NC-ND 4.0**（非商业、禁止演绎，训练模型有风险）；Emilia 是 **CC BY-NC 4.0**（非商业）；AISHELL 需要学术许可。都不适合作为“默认可训练”的基线。

## 下载

```powershell
$dir = '<local data dir>\thchs30'
New-Item -ItemType Directory -Path $dir -Force | Out-Null

# 主站慢时用 ELDA 镜像；支持断点续传。
curl.exe -L --retry 3 --continue-at - `
  --output "$dir\data_thchs30.tgz" `
  https://openslr.elda.org/resources/18/data_thchs30.tgz
```

- 文件大小：**6,453,425,169 字节（约 6.0 GiB）**。
- 来源页：<https://www.openslr.org/18/>（License: Apache License v.2.0）。
- 本仓库**不提交**音频；只保留下载/清单脚本与统计。

## 解压与清单

```powershell
tar -xzf "$dir\data_thchs30.tgz" -C $dir

python scripts/prepare-thchs30-manifest.py `
  "$dir\data_thchs30" `
  "$dir\manifest.jsonl"
```

清单每行：

```json
{"audio":"train/A11_0.wav","text":"绿 是 阳春 三 月 里 一 个 极 好 的 颜 色","speaker":"A11","split":"train","duration":6.2}
```

脚本用 Python 标准库 `wave` 读时长，不依赖第三方包；`train.list` / `dev.list` / `test.list` 存在时自动标记 split，否则为 `unknown`。

## 实测统计（2026-10-18）

- 文件：`data_thchs30.tgz`，6,453,425,169 字节，SHA256 `87e9231726af43b8ada6f84d2870fec4ebb23cb730439adbaacdc1dee77dbd1e`。
- 解压后：`data/` 下 13,388 个唯一 WAV + 13,388 个 `.wav.trn`；`train/dev/test` 目录是重复副本，脚本按 stem 去重。
- 清单：13,388 条，**34.16 小时**，60 个说话人，无缺失文本。
- 切分：train 12,065 / dev 662 / test 661（tarball 没有官方 list，用 stem 的稳定哈希做 90/5/5）。
- 时长：4.46–16.31 秒/条；`manifest.jsonl` 约 2.86 MB。
- 校验：`Get-FileHash` 的 SHA256 与上面一致；清单每行可被 JSON 解析。

## 权利边界

- THCHS-30 的 Apache-2.0 只覆盖**这份语料**；它不包含灰泽满的声音，也不授予任何角色/声音权利。
- 用这份数据训练出来的是通用普通话 TTS，不是“灰泽满音色”。
- 要灰泽满本人音色，仍然需要权利人的书面授权/授权参考音；不要把 THCHS-30 当成绕过授权的替代。
- 音频、权重、训练集不提交进本仓库；只提交脚本、清单格式和统计。
