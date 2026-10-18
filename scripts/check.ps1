# 本文件保存为 UTF-8 BOM：Windows PowerShell 5.1 按 ANSI 读脚本，无 BOM 时中文注释会乱码。
# TheMasterplan 权威验证入口（PowerShell 委托）— HazePersona
# 唯一权威命令是 bash scripts/check.sh；本脚本只找随 Git 安装的 bash 转发，
# 不维护第二套验证规则（新增检查只改 scripts/check.sh，这里不需要同步）。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

function Find-GitBash {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    $execPath = & git --exec-path 2>$null
    if ($LASTEXITCODE -eq 0 -and $execPath) {
      # <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
      $bin = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $execPath))) 'bin\bash.exe'
      if (Test-Path -LiteralPath $bin) { return $bin }
    }
  }
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($bash) { return $bash.Source }
  return $null
}

$bash = Find-GitBash
if (-not $bash) {
  throw 'bash not found: install Git for Windows, or run "bash scripts/check.sh" directly'
}

Push-Location $root
try {
  & $bash 'scripts/check.sh'
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
