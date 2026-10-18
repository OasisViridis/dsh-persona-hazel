# HazePersona deploy.ps1 — install/sync the Haze persona plugin
# (plugin/dsh-persona-hazel) into a DSH profile.
#
# The DSH desktop client (Electron, DSH 0.2.x) is the default target: it boots
# $DSH_HOME/profiles/desktop. `dsh plugin --profile desktop ...` refuses to run
# ("profile desktop is managed exclusively by the Electron application"), so a
# local dev plugin is wired through the profile files themselves:
#   1) sync persona/soul-card.md -> plugin/dsh-persona-hazel/persona.txt (hot reload)
#   2) build persona/recall + speech/behavior/world -> plugin/dsh-persona-hazel/recall-data.json
#   3) ensure package.json  "dsh-persona-hazel": "link:<checkout>/plugin/dsh-persona-hazel"
#   4) ensure node_modules/dsh-persona-hazel resolves to that plugin directory
#   5) ensure one `persona-hazel` insert row in cordis.patch.yml
#
# Usage:
#   .\deploy.ps1                 # sync + wire the auto-detected profile
#   .\deploy.ps1 -Profile web    # legacy `dsh web` profile instead of desktop
#   .\deploy.ps1 -DryRun         # print the plan, write nothing
#   .\deploy.ps1 -Verify         # read-only wiring check; exits 1 on any failure
#
# A NEW plugin or plugin code change needs a full DSH restart; afterwards persona.txt / recall-data.json edits hot-reload.
param(
  [string]$Profile,
  [string]$DshHome,
  [switch]$DryRun,
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginDir = Join-Path $root 'plugin\dsh-persona-hazel'
$soulCard = Join-Path $root 'persona\soul-card.md'
$personaTxt = Join-Path $pluginDir 'persona.txt'

if (-not $DshHome) {
  $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}

# Profile resolution: explicit > running DSH session > installed profiles > web.
if (-not $Profile) {
  if ($env:DSH_PROFILE) {
    $Profile = $env:DSH_PROFILE
  }
  elseif (Test-Path (Join-Path $DshHome 'profiles\desktop\package.json')) {
    $Profile = 'desktop'
  }
  else {
    $Profile = 'web'
  }
}

$profileDir = Join-Path $DshHome "profiles\$Profile"
$packageJson = Join-Path $profileDir 'package.json'
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
$linkPath = Join-Path $profileDir 'node_modules\dsh-persona-hazel'
$linkSpec = 'link:' + ($pluginDir -replace '\\', '/')

Write-Host "profile : $Profile  ($profileDir)"
Write-Host "plugin  : $pluginDir"
if ($DryRun) { Write-Host 'mode    : dry run (no writes)' }
if ($Verify) { Write-Host 'mode    : verify only (no writes)' }

if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) {
  throw "DSH profile not found: $profileDir (start the DSH client once so it creates the profile, or pass -Profile/-DshHome)"
}
if (-not (Test-Path -LiteralPath $pluginDir -PathType Container)) {
  throw "plugin directory missing: $pluginDir"
}

function Get-Utf8Text([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  return [System.IO.File]::ReadAllText($path)
}

function Write-Utf8NoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# 1) persona card -> plugin persona.txt
function Sync-PersonaCard {
  $cardHash = (Get-FileHash -LiteralPath $soulCard -Algorithm SHA256).Hash
  $txtHash = if (Test-Path -LiteralPath $personaTxt) { (Get-FileHash -LiteralPath $personaTxt -Algorithm SHA256).Hash } else { '' }
  if ($cardHash -eq $txtHash) { return 'persona.txt already in sync' }
  if ($DryRun -or $Verify) { return 'persona.txt OUT OF SYNC' }
  Copy-Item -LiteralPath $soulCard -Destination $personaTxt -Force
  return "persona.txt synced ($((Get-Item -LiteralPath $personaTxt).Length) bytes)"
}

# 2) persona data -> plugin recall-data.json（人格召回运行时数据，构建产物）
function Sync-RecallData {
  $builder = Join-Path $root 'scripts\build-recall-data.mjs'
  if (-not (Test-Path -LiteralPath $builder)) { return 'recall-data build script MISSING' }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 'recall-data FAILED (node not found; run scripts/build-recall-data.mjs manually)' }
  $mode = if ($Verify) { '--check' } elseif ($DryRun) { '--dry-run' } else { '' }
  $output = & $node.Source $builder $mode 2>&1
  if ($LASTEXITCODE -ne 0) {
    if ($Verify -and (($output -join "`n") -match 'out of date')) { return 'recall-data OUT OF SYNC (run scripts/build-recall-data.mjs)' }
    return ('recall-data build FAILED: ' + (($output | Select-Object -Last 3) -join ' '))
  }
  if ($Verify) { return 'recall-data up to date' }
  if ($DryRun) { return 'recall-data generation planned' }
  return 'recall-data generated'
}

# 3) package.json link dependency
function Ensure-ProfileDependency {
  $raw = Get-Utf8Text $packageJson
  if ($raw -match '"dsh-persona-hazel"\s*:') { return 'package.json dependency present' }
  if ($DryRun -or $Verify) { return 'package.json dependency MISSING' }
  $match = [regex]::Match($raw, '"dependencies"[ \t]*:[ \t]*\{')
  if (-not $match.Success) {
    throw ('cannot add the dependency automatically (no "dependencies" object in ' + $packageJson + '); add "dsh-persona-hazel": "' + $linkSpec + '" manually')
  }
  $eol = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  $lineStart = $raw.LastIndexOf("`n", [Math]::Max(0, $match.Index - 1)) + 1
  $linePrefix = $raw.Substring($lineStart, $match.Index - $lineStart)
  $indent = ($linePrefix -replace '[^ \t].*$', '') + '  '
  $entry = '"dsh-persona-hazel": "' + $linkSpec + '",'
  $afterIndex = $match.Index + $match.Length
  $rest = $raw.Substring($afterIndex)
  if ($rest.StartsWith($eol)) {
    # block-style object (pnpm writes this): insert as the first dependency line
    $updated = $raw.Insert($afterIndex + $eol.Length, $indent + $entry + $eol)
  }
  elseif ($rest.StartsWith("`n")) {
    $updated = $raw.Insert($afterIndex + 1, $indent + $entry + "`n")
  }
  else {
    # compact object: fall back to a new line before the inline entries
    $updated = $raw.Insert($afterIndex, $eol + $indent + $entry)
  }
  Write-Utf8NoBom $packageJson $updated
  return "package.json dependency added ($linkSpec)"
}

# 4) node_modules link
function Ensure-NodeModulesLink {
  if (Test-Path -LiteralPath $linkPath) {
    $target = (Get-Item -LiteralPath $linkPath -Force).Target
    $targetText = if ($target -is [array]) { ($target -join ';') } else { "$target" }
    $expected = (Resolve-Path -LiteralPath $pluginDir).Path
    if ($targetText -and ($targetText.TrimEnd('\') -ne $expected.TrimEnd('\'))) {
      return "node_modules link present but points elsewhere: $targetText"
    }
    return 'node_modules link present'
  }
  if ($DryRun -or $Verify) { return 'node_modules link MISSING' }
  $parent = Split-Path -Parent $linkPath
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null
  return "node_modules junction created -> $pluginDir"
}

# 5) cordis.patch.yml insert row
function Ensure-PatchRow {
  $content = Get-Utf8Text $patchFile
  if ($content -match 'dsh-persona-hazel') { return 'cordis.patch.yml insert row present' }
  if ($DryRun -or $Verify) { return 'cordis.patch.yml insert row MISSING' }
  $eol = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
  $block = @(
    '# HazePersona: global persona section (hazel:soul), loaded from this checkout.',
    '- insert:',
    '    - id: persona-hazel',
    "      name: 'dsh-persona-hazel'"
  ) -join $eol
  $base = $content.TrimEnd("`r", "`n")
  $next = if ($base) { $base + $eol + $eol + $block + $eol } else { $block + $eol }
  Write-Utf8NoBom $patchFile $next
  return 'cordis.patch.yml insert row added'
}

# Planned steps; -Verify only reports, -DryRun only prints.
$steps = @(
  @{ Name = 'persona.txt'; Run = { Sync-PersonaCard } },
  @{ Name = 'recall-data'; Run = { Sync-RecallData } },
  @{ Name = 'dependency'; Run = { Ensure-ProfileDependency } },
  @{ Name = 'link'; Run = { Ensure-NodeModulesLink } },
  @{ Name = 'patch'; Run = { Ensure-PatchRow } }
)

$problems = @()
foreach ($step in $steps) {
  $result = & $step.Run
  $isProblem = $result -match 'MISSING|OUT OF SYNC|FAILED|points elsewhere'
  if ($isProblem) { $problems += $result }
  $tag = if ($DryRun) { '[plan]' } elseif ($isProblem) { '[warn]' } else { '[ ok ]' }
  Write-Host ("{0} {1}: {2}" -f $tag, $step.Name, $result)
}

if ($Verify) {
  if ($problems.Count -gt 0) {
    Write-Host "verify failed ($($problems.Count) problem(s)); run .\deploy.ps1 to repair"
    exit 1
  }
  Write-Host 'verify ok: profile wiring is complete'
  exit 0
}

if ($DryRun) {
  if ($problems.Count -gt 0) { Write-Host "dry run: $($problems.Count) step(s) would change files" }
  else { Write-Host 'dry run: nothing to change' }
  exit 0
}

if ($problems.Count -gt 0) {
  Write-Host "wiring incomplete ($($problems.Count) problem(s)); fix the warnings above and rerun"
  exit 1
}

Write-Host ''
if ($Profile -eq 'desktop') {
  Write-Host 'Next: a NEW plugin needs a FULL DSH desktop restart (quit from the tray, then relaunch).'
} else {
  Write-Host 'Next: a NEW plugin needs a dsh restart (kill the dsh web process, then click restart in the desktop dialog).'
}
Write-Host 'Afterwards persona.txt edits hot-reload; verify with: node deploy\verify-live.mjs'
