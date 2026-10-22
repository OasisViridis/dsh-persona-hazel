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
#   5) drop a legacy `- id: persona-hazel` insert row from cordis.patch.yml
#      (older wiring: the package is a bundle now, so the insert row would load
#      the persona twice)
#   6) select the bundle: "dsh-persona-hazel" in package.json dsh.profile.bundles —
#      that list is what the DSH Plugins page shows and toggles; the package's own
#      cordis.patch.yml inserts the `persona-hazel` row
#
# Usage:
#   .\deploy.ps1                 # sync + wire the auto-detected profile
#   .\deploy.ps1 -Profile web    # legacy `dsh web` profile instead of desktop
#   .\deploy.ps1 -DryRun         # print the plan, write nothing
#   .\deploy.ps1 -Verify         # read-only wiring check; exits 1 on any failure
#   .\deploy.ps1 -DshHome <dir>  # Harness home override (default: $env:DSH_HOME, then ~/.dsh)
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

# 2) persona data -> plugin recall-data.json（人格召回运行时数据，构建产物）
function Sync-RecallData {
  $builder = Join-Path $root 'scripts\build-recall-data.mjs'
  if (-not (Test-Path -LiteralPath $builder)) { return (New-StepResult $false 'recall-data build script MISSING') }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return (New-StepResult $false 'recall-data FAILED (node not found; run scripts/build-recall-data.mjs manually)') }
  $mode = if ($Verify) { '--check' } elseif ($DryRun) { '--dry-run' } else { '' }
  $output = & $node.Source $builder $mode 2>&1
  if ($LASTEXITCODE -ne 0) {
    if ($Verify -and (($output -join "`n") -match 'out of date')) { return (New-StepResult $false 'recall-data OUT OF SYNC (run scripts/build-recall-data.mjs)') }
    return (New-StepResult $false ('recall-data build FAILED: ' + (($output | Select-Object -Last 3) -join ' ')))
  }
  if ($Verify) { return (New-StepResult $true 'recall-data up to date') }
  if ($DryRun) { return (New-StepResult $true 'recall-data generation planned') }
  return (New-StepResult $true 'recall-data generated')
}

# 3) package.json link dependency
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

# 4) node_modules link
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

# 5) drop the legacy cordis.patch.yml insert row
#    The package used to be a plain plugin loaded by an insert row. It ships its
#    own bundle patch now, so keeping that row would mount the persona twice.
function Remove-LegacyPatchRow {
  $content = Get-Utf8Text $patchFile
  if (-not $content) { return (New-StepResult $true 'cordis.patch.yml has no legacy insert row') }
  $eol = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
  $lines = @($content -split "`r?`n")

  $blockStart = -1
  $blockEnd = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch '^- insert:[ \t]*$') { continue }
    $hit = $false
    $j = $i + 1
    while ($j -lt $lines.Count) {
      $line = $lines[$j]
      if ($line -match '^[ \t]*$') { $j++; continue }
      if ($line -notmatch '^[ \t]') { break }
      if ($line -match '^[ \t]+- id:[ \t]*persona-hazel[ \t]*$') { $hit = $true }
      $j++
    }
    if ($hit) { $blockStart = $i; $blockEnd = $j; break }
  }
  if ($blockStart -lt 0) { return (New-StepResult $true 'cordis.patch.yml has no legacy insert row') }
  if ($DryRun -or $Verify) { return (New-StepResult $false 'legacy `- id: persona-hazel` insert row still in cordis.patch.yml (it double-injects now; rerun .\deploy.ps1 without -Verify)') }

  # Take the comment lines that introduce the row with it, and keep the block's
  # trailing blank lines so the next entry keeps its separator.
  $start = $blockStart
  while ($start -gt 0 -and $lines[$start - 1] -match '^#') { $start-- }
  $end = $blockEnd
  while ($end -gt $start -and $lines[$end - 1] -match '^[ \t]*$') { $end-- }
  $kept = @()
  if ($start -gt 0) { $kept += $lines[0..($start - 1)] }
  if ($end -lt $lines.Count) { $kept += $lines[$end..($lines.Count - 1)] }
  $text = ($kept -join $eol).TrimEnd("`r", "`n") + $eol
  Write-Utf8NoBom $patchFile $text
  return (New-StepResult $true 'legacy cordis.patch.yml insert row removed')
}

# 6) select the bundle in package.json dsh.profile.bundles
#    The Plugins page lists exactly that ordered list; the package declares its
#    own bundle patch, so selecting it is the whole wiring.
function Ensure-BundleSelection {
  $raw = Get-Utf8Text $packageJson
  if (-not $raw) {
    if ($DryRun -or $Verify) { return (New-StepResult $false 'package.json missing') }
    throw ('package.json not found in ' + $profileDir + '; start the DSH client once so it creates the profile')
  }
  $match = [regex]::Match($raw, '"bundles"[ \t]*:[ \t]*\[(?<body>[^\]]*)\]')
  if (-not $match.Success) {
    if ($DryRun -or $Verify) { return (New-StepResult $false 'package.json has no dsh.profile.bundles list') }
    throw ('cannot select the bundle automatically (no "bundles" array in ' + $packageJson + '); add "dsh-persona-hazel" to dsh.profile.bundles manually')
  }
  $body = $match.Groups['body'].Value
  if ($body -match '"dsh-persona-hazel"') { return (New-StepResult $true 'dsh.profile.bundles selects dsh-persona-hazel') }
  if ($DryRun -or $Verify) { return (New-StepResult $false 'dsh.profile.bundles does NOT select dsh-persona-hazel (the DSH Plugins page cannot show it)') }

  # Keep pnpm's formatting: append after the current last element, same indent.
  $eol = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  $gap = [regex]::Match($body, '[ \t]*$').Value
  $indent = $gap + '  '
  $items = @($body -split "`r?`n" | Where-Object { $_ -match '\S' })
  if ($items.Count -gt 0) { $indent = ([regex]::Match($items[-1], '^[ \t]*')).Value }
  $entry = '"dsh-persona-hazel"'
  $core = $body.Substring(0, $body.Length - $gap.Length)
  if ([string]::IsNullOrWhiteSpace($core)) {
    $newBody = $eol + $indent + $entry + $eol + $gap
  }
  else {
    $trimmed = $core.TrimEnd()
    if (-not $trimmed.EndsWith(',')) { $trimmed += ',' }
    $newBody = $trimmed + $eol + $indent + $entry + $eol + $gap
  }
  $bodyIndex = $match.Groups['body'].Index
  $updated = $raw.Substring(0, $bodyIndex) + $newBody + $raw.Substring($bodyIndex + $body.Length)
  Assert-Json $updated $packageJson
  Write-Utf8NoBom $packageJson $updated
  return (New-StepResult $true 'dsh.profile.bundles now selects dsh-persona-hazel')
}

# Planned steps; -Verify only reports, -DryRun only prints.
$steps = @(
  @{ Name = 'persona.txt'; Run = { Sync-PersonaCard } },
  @{ Name = 'recall-data'; Run = { Sync-RecallData } },
  @{ Name = 'dependency'; Run = { Ensure-ProfileDependency } },
  @{ Name = 'link'; Run = { Ensure-NodeModulesLink } },
  @{ Name = 'legacy-patch'; Run = { Remove-LegacyPatchRow } },
  @{ Name = 'bundle'; Run = { Ensure-BundleSelection } }
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
Write-Host "The DSH Plugins page lists this plugin as a bundle (profile package.json dsh.profile.bundles -> dsh-persona-hazel)."
