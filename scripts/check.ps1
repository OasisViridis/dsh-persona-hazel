# 本文件保存为 UTF-8 BOM：Windows PowerShell 5.1 按 ANSI 读脚本，无 BOM 时中文锚点会乱码。
# TheMasterplan 权威验证入口（PowerShell 委托）— HazePersona
# 委托同一权威命令语义，不维护第二套验证规则。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Push-Location $root
try {
  if (-not (Test-Path '.git' -PathType Container) -and -not (Test-Path '.jj' -PathType Container)) {
    throw 'not a repository root'
  }

  # 1) 插件语法（index.js 是 DSH 插件入口；recall.mjs 是纯召回逻辑）
  node --check 'plugin\dsh-persona-hazel\index.js'
  node --check 'plugin\dsh-persona-hazel\recall.mjs'
  Write-Output 'ok: plugin syntax'

  # 2) 脚本语法（DSH 端到端验证、召回数据构建、人格评测）
  node --check 'deploy\verify-live.mjs'
  node --check 'scripts\build-recall-data.mjs'
  if (Test-Path 'scripts\persona-eval.mjs') { node --check 'scripts\persona-eval.mjs' }
  Write-Output 'ok: script syntax'

  # 3) 召回数据与 persona/ 源数据同步（构建产物不得过期）
  node 'scripts\build-recall-data.mjs' --check
  if ($LASTEXITCODE -ne 0) { throw 'recall-data.json is out of date (run node scripts/build-recall-data.mjs)' }
  Write-Output 'ok: recall-data.json in sync'

  # 4) 召回逻辑单测
  node --test 'plugin\dsh-persona-hazel\test\recall.test.mjs' 'plugin\dsh-persona-hazel\test\plugin.test.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'recall unit tests failed' }
  Write-Output 'ok: recall unit tests'

  # 5) 人设卡同步一致性（soul-card.md、haze-persona.txt、插件 persona.txt 三者一致）
  $card = (Get-FileHash 'persona\soul-card.md' -Algorithm SHA256).Hash
  $plugin = (Get-FileHash 'plugin\dsh-persona-hazel\persona.txt' -Algorithm SHA256).Hash
  $archive = (Get-FileHash 'persona\haze-persona.txt' -Algorithm SHA256).Hash
  if ($card -ne $plugin -or $card -ne $archive) {
    throw 'plugin persona.txt or haze-persona.txt differs from persona/soul-card.md (run deploy.ps1; resync haze-persona.txt)'
  }
  Write-Output 'ok: persona.txt and haze-persona.txt in sync with soul-card.md'

  # 6) 人格锚点（PS 5.1 必须显式 UTF8，默认按 ANSI 读会乱码）
  $card = Get-Content 'persona\soul-card.md' -Raw -Encoding UTF8
  if (-not $card.Contains('永远16岁的风纪委员')) { throw 'persona anchors missing' }
  Write-Output 'ok: persona anchors present'

  Write-Output 'all checks passed'
} finally {
  Pop-Location
}
