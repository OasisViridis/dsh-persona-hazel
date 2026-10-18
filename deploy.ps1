# HazePersona deploy.ps1 — install/sync the Haze persona plugin
# (plugin/dsh-persona-hazel) into a DSH profile.
#
# The DSH desktop client (Electron, DSH 0.2.x) is the default target: it boots
# $DSH_HOME/profiles/desktop. `dsh plugin --profile desktop ...` refuses to run
# ("profile desktop is managed exclusively by the Electron application"), so a
# local dev plugin is wired through the profile files themselves:
#   1) sync persona/soul-card.md -> plugin/dsh-persona-hazel/persona.txt (hot reload)
#   2) ensure package.json  "dsh-persona-hazel": "link:<checkout>/plugin/dsh-persona-hazel"
#   3) ensure node_modules/dsh-persona-hazel resolves to that plugin directory
#   4) ensure one `persona-hazel` insert row in cordis.patch.yml
#
# Usage:
#   .\deploy.ps1                 # sync + wire the auto-detected profile
#   .\deploy.ps1 -Profile web    # legacy `dsh web` profile instead of desktop
#   .\deploy.ps1 -DryRun         # print the plan, write nothing
#   .\deploy.ps1 -Verify         # read-only wiring check; exits 1 on any failure
#   .\deploy.ps1 -DshHome <dir>  # Harness home override (default: $env:DSH_HOME, then ~/.dsh)
#
# A NEW plugin needs a full DSH restart; afterwards persona.txt edits hot-reload.
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

# Every step reports a structured outcome instead of a status keyword inside its
# message: the verify gate must not depend on English wording.
function New-StepResult([bool]$ok, [string]$message) {
  return @{ Ok = $ok; Message = $message }
}

# Refuse to write a package.json the host could no longer parse.
function Assert-Json([string]$text, [string]$path) {
  try { $null = $text | ConvertFrom-Json }
  catch { throw ("refusing to write " + $path + ": the edit would produce invalid JSON, file left untouched") }
}

# 1) persona card -> plugin persona.txt
function Sync-PersonaCard {
  $cardHash = (Get-FileHash -LiteralPath $soulCard -Algorithm SHA256).Hash
  $txtHash = if (Test-Path -LiteralPath $personaTxt) { (Get-FileHash -LiteralPath $personaTxt -Algorithm SHA256).Hash } else { '' }
  if ($cardHash -eq $txtHash) { return (New-StepResult $true 'persona.txt already in sync') }
  if ($DryRun -or $Verify) { return (New-StepResult $false 'persona.txt OUT OF SYNC') }
  Copy-Item -LiteralPath $soulCard -Destination $personaTxt -Force
  return (New-StepResult $true "persona.txt synced ($((Get-Item -LiteralPath $personaTxt).Length) bytes)")
}

# 2) package.json link dependency
function Ensure-ProfileDependency {
  $raw = Get-Utf8Text $packageJson
  if (-not $raw) {
    if ($DryRun -or $Verify) { return (New-StepResult $false 'package.json missing') }
    throw ('package.json not found in ' + $profileDir + '; start the DSH client once so it creates the profile, or add "dsh-persona-hazel": "' + $linkSpec + '" manually')
  }
  # The entry only counts as wired when it still points at THIS checkout: a stale
  # link (repo moved) or a published version is a mismatch, not "present".
  $existing = [regex]::Match($raw, '"dsh-persona-hazel"\s*:\s*"([^"]*)"')
  if ($existing.Success -and $existing.Groups[1].Value -cne $linkSpec) {
    if ($DryRun -or $Verify) {
      return (New-StepResult $false ('package.json dependency MISMATCH (found ' + $existing.Groups[1].Value + ', expected ' + $linkSpec + ')'))
    }
    $value = $existing.Groups[1]
    $updated = $raw.Substring(0, $value.Index) + $linkSpec + $raw.Substring($value.Index + $value.Length)
    Assert-Json $updated $packageJson
    Write-Utf8NoBom $packageJson $updated
    return (New-StepResult $true ('package.json dependency updated to ' + $linkSpec))
  }
  if ($existing.Success) { return (New-StepResult $true 'package.json dependency present') }
  if ($raw -match '"dsh-persona-hazel"\s*:') {
    if ($DryRun -or $Verify) { return (New-StepResult $false ('package.json dependency has a non-string value (expected ' + $linkSpec + ')')) }
    throw ('the dsh-persona-hazel entry in ' + $packageJson + ' is not a plain string; set it to "' + $linkSpec + '" manually')
  }
  if ($DryRun -or $Verify) { return (New-StepResult $false 'package.json dependency MISSING') }
  $match = [regex]::Match($raw, '"dependencies"[ \t]*:[ \t]*\{')
  if (-not $match.Success) {
    throw ('cannot add the dependency automatically (no "dependencies" object in ' + $packageJson + '); add "dsh-persona-hazel": "' + $linkSpec + '" manually')
  }
  $eol = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  $lineStart = $raw.LastIndexOf("`n", [Math]::Max(0, $match.Index - 1)) + 1
  $linePrefix = $raw.Substring($lineStart, $match.Index - $lineStart)
  $keyIndent = ($linePrefix -replace '[^ \t].*$', '')
  $indent = $keyIndent + '  '
  $entry = '"dsh-persona-hazel": "' + $linkSpec + '"'
  $afterIndex = $match.Index + $match.Length
  $rest = $raw.Substring($afterIndex)
  $empty = [regex]::Match($rest, '^([ \t]*(?:\r?\n[ \t]*)?)\}')
  if ($empty.Success) {
    # Empty object: the lone entry must not get a trailing comma, otherwise the
    # closing brace turns it into invalid JSON (pnpm writes `{}`, `{ }` and `{ \n }`).
    $gap = $empty.Groups[1].Value
    if ($gap.Contains("`n")) {
      $nl = if ($gap.Contains("`r`n")) { "`r`n" } else { "`n" }
      $updated = $raw.Insert($afterIndex, $nl + $indent + $entry)
    }
    else {
      $updated = $raw.Insert($afterIndex + $gap.Length, $eol + $indent + $entry + $eol + $keyIndent)
    }
  }
  elseif ($rest.StartsWith($eol)) {
    # block-style object (pnpm writes this): insert as the first dependency line
    $updated = $raw.Insert($afterIndex + $eol.Length, $indent + $entry + ',' + $eol)
  }
  elseif ($rest.StartsWith("`n")) {
    $updated = $raw.Insert($afterIndex + 1, $indent + $entry + ',' + "`n")
  }
  else {
    # compact object: fall back to a new line before the inline entries
    $updated = $raw.Insert($afterIndex, $eol + $indent + $entry + ',')
  }
  Assert-Json $updated $packageJson
  Write-Utf8NoBom $packageJson $updated
  return (New-StepResult $true ('package.json dependency added (' + $linkSpec + ')'))
}

# 3) node_modules link
function Ensure-NodeModulesLink {
  if (Test-Path -LiteralPath $linkPath) {
    $target = (Get-Item -LiteralPath $linkPath -Force).Target
    $targetText = if ($target -is [array]) { ($target -join ';') } else { "$target" }
    $expected = (Resolve-Path -LiteralPath $pluginDir).Path
    if ($targetText -and ($targetText.TrimEnd('\') -ne $expected.TrimEnd('\'))) {
      # pnpm owns this link, so repair it by hand rather than deleting a symlink
      # the package manager created; say so, because rerunning alone cannot fix it.
      return (New-StepResult $false ('node_modules link present but points elsewhere: ' + $targetText + '; repair: cmd /c rmdir "' + $linkPath + '", then rerun'))
    }
    return (New-StepResult $true 'node_modules link present')
  }
  if ($DryRun -or $Verify) { return (New-StepResult $false 'node_modules link MISSING') }
  $parent = Split-Path -Parent $linkPath
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null
  return (New-StepResult $true "node_modules junction created -> $pluginDir")
}

# 4) cordis.patch.yml insert row
function Ensure-PatchRow {
  $content = Get-Utf8Text $patchFile
  # Match the loader entry itself: a leftover comment that merely mentions the
  # plugin must not be mistaken for a wired insert row.
  if ($content -match '(?m)^[ \t]*-[ \t]+id:[ \t]*persona-hazel[ \t]*$') { return (New-StepResult $true 'cordis.patch.yml insert row present') }
  if ($DryRun -or $Verify) { return (New-StepResult $false 'cordis.patch.yml insert row MISSING') }
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
  return (New-StepResult $true 'cordis.patch.yml insert row added')
}

# Planned steps; -Verify only reports, -DryRun only prints.
$steps = @(
  @{ Name = 'persona.txt'; Run = { Sync-PersonaCard } },
  @{ Name = 'dependency'; Run = { Ensure-ProfileDependency } },
  @{ Name = 'link'; Run = { Ensure-NodeModulesLink } },
  @{ Name = 'patch'; Run = { Ensure-PatchRow } }
)

$problems = @()
foreach ($step in $steps) {
  $result = & $step.Run
  if (-not $result.Ok) { $problems += $result.Message }
  $tag = if ($DryRun) { '[plan]' } elseif (-not $result.Ok) { '[warn]' } else { '[ ok ]' }
  Write-Host ("{0} {1}: {2}" -f $tag, $step.Name, $result.Message)
}

if ($Verify) {
  if ($problems.Count -gt 0) {
    Write-Host "verify failed ($($problems.Count) problem(s)); run .\deploy.ps1 to repair (link problems print the manual command)"
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
