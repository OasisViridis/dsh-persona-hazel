<#
.SYNOPSIS
  本地 F5-TTS 零样本声音 demo（F）。只做本地非商业验证，不调用公开声音服务。

.DESCRIPTION
  前置条件（见 docs/voice-prototype.md）：
    - 本地 F5-TTS 工作区，包含 .venv 与克隆的 F5-TTS；
    - 环境变量 HAZEL_TTS_HOME 指向该工作区；
    - 参考音频必须是已获授权、10–30 秒、单人干净的片段。
  -RefText 留空时脚本先用 Whisper 转写参考音，再传给 F5-TTS；速度更慢但省一次手工。

.EXAMPLE
  $env:HAZEL_TTS_HOME = '<local F5-TTS workspace>'
  .\scripts\tts-demo.ps1 -RefAudio .\ref.wav -Text '晚上好，晚上好。' -OutFile "$env:TEMP\hazel-demo.wav"
#>
param(
  [Parameter(Mandatory = $true)][string]$RefAudio,
  [string]$RefText = '',
  [Parameter(Mandatory = $true)][string]$Text,
  [string]$OutFile = (Join-Path $env:TEMP 'hazel-tts-demo.wav'),
  [string]$TtsHome = $env:HAZEL_TTS_HOME
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($TtsHome)) {
  throw 'HAZEL_TTS_HOME is not set; see docs/voice-prototype.md for the local F5-TTS setup.'
}
$cli = Join-Path $TtsHome '.venv\Scripts\f5-tts_infer-cli.exe'
if (-not (Test-Path -LiteralPath $cli)) {
  throw "F5-TTS CLI not found: $cli (set HAZEL_TTS_HOME to the workspace containing .venv and F5-TTS)"
}
if (-not (Test-Path -LiteralPath $RefAudio)) {
  throw "reference audio not found: $RefAudio"
}

$ref = (Resolve-Path -LiteralPath $RefAudio).Path
$outDir = Split-Path -Parent $OutFile
if ([string]::IsNullOrWhiteSpace($outDir)) { $outDir = (Get-Location).Path }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$outName = Split-Path -Leaf $OutFile

if ([string]::IsNullOrWhiteSpace($RefText)) {
  $py = Join-Path $TtsHome '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $py)) { throw "python not found: $py" }
  $transcriptScript = Join-Path $PSScriptRoot 'tts-transcribe.py'
  if (-not (Test-Path -LiteralPath $transcriptScript)) { throw "transcribe helper not found: $transcriptScript" }
  $transcriptFile = Join-Path ([IO.Path]::GetTempPath()) ('hazel-ref-' + [guid]::NewGuid().ToString('N') + '.txt')

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $py $transcriptScript $ref $transcriptFile 2>$null
    $transcribeExit = $LASTEXITCODE
    if ($transcribeExit -eq 0 -and (Test-Path -LiteralPath $transcriptFile)) {
      $RefText = (Get-Content -LiteralPath $transcriptFile -Raw -Encoding UTF8).Trim()
    }
  }
  finally {
    Remove-Item -LiteralPath $transcriptFile -Force -ErrorAction SilentlyContinue
    $ErrorActionPreference = $previousErrorAction
  }
  if ($transcribeExit -ne 0 -or [string]::IsNullOrWhiteSpace($RefText)) {
    throw 'failed to transcribe reference audio; pass -RefText explicitly'
  }
}

& $cli --model F5TTS_v1_Base `
  --ref_audio $ref `
  --ref_text $RefText `
  --gen_text $Text `
  --output_dir $outDir `
  --output_file $outName
if ($LASTEXITCODE -ne 0) { throw "F5-TTS failed with exit code $LASTEXITCODE" }

$wav = Join-Path $outDir $outName
if (-not (Test-Path -LiteralPath $wav)) { throw "F5-TTS finished but output is missing: $wav" }
$duration = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $wav
if ($LASTEXITCODE -ne 0) { throw 'ffprobe failed on the generated audio' }
Write-Output ("ok: {0} ({1:N2}s)" -f $wav, [double]$duration)
