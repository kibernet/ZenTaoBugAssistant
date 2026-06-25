param(
  [Parameter(Mandatory=$true)]
  [string]$PromptFile
)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
  $__ztUtf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [Console]::InputEncoding = $__ztUtf8
  [Console]::OutputEncoding = $__ztUtf8
  $OutputEncoding = $__ztUtf8
  chcp 65001 > $null 2>$null
} catch {
  # Keep going even if the host refuses encoding changes.
}
$__ztPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path
$__ztWorkspace = (Get-Location).Path
function Invoke-ZenTaoCursorAgent {
  param([string]$Instruction)
  $state = @{ printed = $false; openLine = $false; busyLine = $false; busyFlag = ''; busyProcess = $null; lastText = ''; streamedText = ''; toolTotal = 0; toolStarted = 0; toolCounts = @{}; toolSeen = @{} }
  function Clear-BusyLine {
    if (-not $state.busyLine) { return }
    if ($state.busyFlag) { Remove-Item -LiteralPath $state.busyFlag -Force -ErrorAction SilentlyContinue }
    if ($state.busyProcess) {
      try {
        [void]$state.busyProcess.WaitForExit(1000)
        if (-not $state.busyProcess.HasExited) { $state.busyProcess.Kill() }
      } catch {}
      $state.busyProcess = $null
    }
    $state.busyFlag = ''
    $width = 120
    try { $width = [Math]::Max(80, [Console]::BufferWidth - 1) } catch {}
    [Console]::Write([char]13 + (' ' * $width) + [char]13)
    $state.busyLine = $false
  }
  function Show-BusyLine {
    param([string]$Text = 'AI working')
    if ($state.openLine -or $state.busyLine) { return }
    $state.busyLine = $true
    $state.busyFlag = [System.IO.Path]::GetTempFileName()
    $safeFlag = $state.busyFlag.Replace("'", "''")
    $safeText = $Text.Replace("'", "''")
    $script = "`$ProgressPreference='SilentlyContinue'; `$flag='$safeFlag'; `$text='$safeText'; `$start=Get-Date; `$i=0; while(Test-Path -LiteralPath `$flag){ `$elapsed=[int]((Get-Date)-`$start).TotalSeconds; `$dots='.' * ((`$i % 3)+1); [Console]::Write(([char]13 + ('{0} {1}s {2}   ' -f `$text, `$elapsed, `$dots))); Start-Sleep -Milliseconds 220; `$i++ }; try { `$width=[Math]::Max(80,[Console]::BufferWidth-1) } catch { `$width=120 }; [Console]::Write(([char]13 + (' ' * `$width) + [char]13))"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    try {
      $state.busyProcess = Start-Process powershell -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-OutputFormat','Text','-EncodedCommand',$encoded) -NoNewWindow -PassThru
    } catch {
      [Console]::Write($Text + ' ... ')
    }
  }
  function Format-ToolCounts {
    $items = @()
    foreach ($key in $state.toolCounts.Keys) { $items += ($key + '=' + $state.toolCounts[$key]) }
    if ($items.Count -eq 0) { return '' }
    return ($items | Sort-Object) -join ', '
  }
  function Shorten-Text {
    param([string]$Value, [int]$Max = 120)
    if (-not $Value) { return '' }
    $text = ($Value -replace '\s+', ' ').Trim()
    if ($text.Length -le $Max) { return $text }
    return $text.Substring(0, $Max - 3) + '...'
  }
  function Shorten-Path {
    param([string]$Value)
    if (-not $Value) { return '' }
    $path = $Value
    if ($path.StartsWith($__ztWorkspace, [System.StringComparison]::OrdinalIgnoreCase)) {
      $path = $path.Substring($__ztWorkspace.Length).TrimStart('\', '/')
    }
    return Shorten-Text $path 140
  }
  function Tool-Summary {
    param($ToolCall, [string]$RawName)
    $name = $RawName
    if ($name.EndsWith('ToolCall')) { $name = $name.Substring(0, $name.Length - 8) }
    $args = $ToolCall.args
    $pattern = ''
    if ($args -and $args.PSObject.Properties.Name -contains 'pattern') { $pattern = [string]$args.pattern }
    if (-not $pattern -and $args -and $args.PSObject.Properties.Name -contains 'query') { $pattern = [string]$args.query }
    if (-not $pattern -and $args -and $args.PSObject.Properties.Name -contains 'regex') { $pattern = [string]$args.regex }
    if (-not $pattern -and $args -and $args.PSObject.Properties.Name -contains 'glob') { $pattern = [string]$args.glob }
    $command = ''
    if ($args -and $args.PSObject.Properties.Name -contains 'command') { $command = [string]$args.command }
    if (-not $command -and $args -and $args.PSObject.Properties.Name -contains 'cmd') { $command = [string]$args.cmd }
    if ($name -eq 'read') { return 'Read ' + (Shorten-Path ([string]$args.path)) }
    if ($name -eq 'grep') { return 'Grepped ' + (Shorten-Text $pattern 120) }
    if ($name -eq 'glob') { return 'Searched files ' + (Shorten-Text $pattern 120) }
    if ($name -eq 'edit' -or $name -eq 'write') { return ($name.Substring(0,1).ToUpper() + $name.Substring(1)) + ' ' + (Shorten-Path ([string]$args.path)) }
    if ($name -eq 'shell' -or $name -eq 'run') { return 'Ran ' + (Shorten-Text $command 120) }
    return ($name.Substring(0,1).ToUpper() + $name.Substring(1))
  }
  function Read-CursorAgentError {
    param([string]$Path)
    $err = ''
    try { $err = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).Trim() } catch {}
    if (-not $err) { return @() }
    $items = New-Object System.Collections.ArrayList
    foreach ($raw in @($err -split '\r?\n')) {
      $line = ([string]$raw).Trim()
      if (-not $line) { continue }
      $line = $line -replace '^.*cursor-agent\.ps1\s*:\s*', ''
      $line = $line -replace '^node\.exe\s*:\s*', ''
      if ($line -match '^\s*\+ ' -or $line -match '^\s*~' -or $line -match '^\s*CategoryInfo' -or $line -match '^\s*FullyQualifiedErrorId') { continue }
      if ($line -match 'cursor-agent\.ps1:\d+' -or $line -match 'run-cursor-agent\.ps1:\d+' -or $line -match '^\s*At line:' -or $line -match '^\s*At .*\.ps1:\d+') { continue }
      if ($line -match '^\s*\&\s*"\$nodePath"' -or $line -match '^\s*NativeCommandError') { continue }
      if ($line -match '\$nodePath' -or $line -match '\$scriptPath' -or $line -match '\$versionName' -or $line -match '\$args' -or $line -match 'scriptPath\\versions' -or $line -match 'index\.js') { continue }
      if ($line -match 'NotSpecified:' -or $line -match 'RemoteException' -or $line -match 'CategoryInfo' -or $line -match 'FullyQualifiedErrorId' -or $line -match 'NativeCommandError' -or $line -match 'edErrorId') { continue }
      if ($line -match '^\s*:') { continue }
      if ($line -eq 'Error:') { continue }
      if (-not $items.Contains($line)) { [void]$items.Add($line) }
      if ($items.Count -ge 6) { break }
    }
    return @($items)
  }
  $__ztErrFile = [System.IO.Path]::GetTempFileName()
  try {
  $__ztOldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
  cursor-agent -p --trust --workspace $__ztWorkspace --output-format stream-json --stream-partial-output $Instruction 2> $__ztErrFile | ForEach-Object {
    $line = [string]$_
    try {
      $event = $line | ConvertFrom-Json -ErrorAction Stop
      if ($event.type -eq 'system' -and $event.subtype -eq 'init') {
        Clear-BusyLine
        Write-Host ('[Cursor Agent] model=' + $event.model + ' workspace=' + $event.cwd) -ForegroundColor DarkGray
        Show-BusyLine 'AI starting'
      } elseif ($event.type -eq 'tool_call') {
        $toolName = ''
        if ($event.tool_call) { $toolName = @($event.tool_call.PSObject.Properties.Name)[0] }
        if (-not $toolName) { $toolName = 'tool' }
        $toolCall = $null
        if ($event.tool_call -and $event.tool_call.PSObject.Properties[$toolName]) { $toolCall = $event.tool_call.PSObject.Properties[$toolName].Value }
        $displayName = $toolName
        if ($displayName.EndsWith('ToolCall')) { $displayName = $displayName.Substring(0, $displayName.Length - 8) }
        if ($event.subtype -eq 'started') {
          $callId = [string]$event.call_id
          if (-not $callId) { $callId = $toolName + ':' + $state.toolStarted }
          if (-not $state.toolSeen.ContainsKey($callId)) {
            $state.toolSeen[$callId] = $true
            $state.toolStarted = [int]$state.toolStarted + 1
            Clear-BusyLine
            if ($state.openLine) { Write-Host ''; $state.openLine = $false }
            if ($state.toolStarted -le 80) {
              Write-Host (Tool-Summary $toolCall $toolName) -ForegroundColor DarkGray
            } elseif (($state.toolStarted % 20) -eq 0) {
              Write-Host ('Working... ' + $state.toolStarted + ' tool calls started') -ForegroundColor DarkGray
            }
            Show-BusyLine
          }
        } elseif ($event.subtype -eq 'completed') {
          if (-not $state.toolCounts.ContainsKey($displayName)) { $state.toolCounts[$displayName] = 0 }
          $state.toolCounts[$displayName] = [int]$state.toolCounts[$displayName] + 1
          $state.toolTotal = [int]$state.toolTotal + 1
          if ($state.toolTotal -gt 0 -and ($state.toolTotal % 24) -eq 0) {
            Clear-BusyLine
            if ($state.openLine) { Write-Host ''; $state.openLine = $false }
            Write-Host ('Tools: ' + $state.toolTotal + ' calls (' + (Format-ToolCounts) + ')') -ForegroundColor DarkGray
            Show-BusyLine
          }
        }
      } elseif ($event.type -eq 'assistant') {
        $text = ''
        foreach ($part in @($event.message.content)) {
          if ($part.type -eq 'text' -and $part.text) { $text += $part.text }
        }
        if ($text) {
          Clear-BusyLine
          $shouldBreakBeforeDelta = $false
          if ($state.lastText -and $text.StartsWith($state.lastText)) {
            $delta = $text.Substring($state.lastText.Length)
          } elseif ($state.streamedText -and $text.StartsWith($state.streamedText)) {
            $delta = $text.Substring($state.streamedText.Length)
          } elseif ($text -eq $state.lastText) {
            $delta = ''
          } elseif ($state.streamedText -and $state.streamedText.EndsWith($text)) {
            $delta = ''
          } elseif ($text.Length -le 120 -and -not $text.Contains("`n")) {
            $delta = $text
          } else {
            $shouldBreakBeforeDelta = $true
            $delta = $text
          }
          if ($state.openLine -and $delta -match '^[\r\n\s]+\p{P}') {
            $delta = $delta -replace '^[\r\n\s]+', ''
            $shouldBreakBeforeDelta = $false
          }
          if ($shouldBreakBeforeDelta -and $state.openLine) {
            [Console]::WriteLine()
            $state.openLine = $false
          }
          if ($delta) {
            [Console]::Write($delta)
            $state.printed = $true
            $state.openLine = -not ($delta -match '[\r\n]$')
            $state.streamedText += $delta
            if (-not $state.openLine) { Show-BusyLine }
          }
          $state.lastText = $text
        }
      } elseif ($event.type -eq 'result') {
        Clear-BusyLine
        if ($state.openLine) { Write-Host ''; $state.openLine = $false }
        if (-not $state.printed -and $event.result) { Write-Host $event.result }
        if ($state.toolTotal -gt 0) { Write-Host ('Tools total: ' + $state.toolTotal + ' calls (' + (Format-ToolCounts) + ')') -ForegroundColor DarkGray }
        if ($event.is_error) {
          Write-Host ('[Cursor Agent] failed duration=' + $event.duration_ms + 'ms') -ForegroundColor Red
        } else {
          Write-Host ('[Cursor Agent] done duration=' + $event.duration_ms + 'ms') -ForegroundColor DarkGray
        }
      }
    } catch {
      if ($line -and -not $line.TrimStart().StartsWith('{')) {
        Clear-BusyLine
        if ($state.openLine) { Write-Host ''; $state.openLine = $false }
        Write-Host $line
      }
    }
  }
  } catch {
    try { [string]$_.Exception.Message | Out-File -LiteralPath $__ztErrFile -Append -Encoding UTF8 } catch {}
  } finally {
    $ErrorActionPreference = $__ztOldErrorActionPreference
  }
  Clear-BusyLine
  if ($state.openLine) { Write-Host '' }
  $__ztExit = $LASTEXITCODE
  if ($__ztExit -eq $null) { $__ztExit = 1 }
  if ($__ztExit -ne 0) {
    $lines = @(Read-CursorAgentError $__ztErrFile)
    if ($lines.Count -gt 0) {
      Write-Host '[Cursor Agent] error:' -ForegroundColor Red
      Write-Host ($lines -join "`n") -ForegroundColor Red
    }
  }
  return $__ztExit
  } finally {
    Remove-Item -LiteralPath $__ztErrFile -Force -ErrorAction SilentlyContinue
  }
}
$__ztExitCode = Invoke-ZenTaoCursorAgent $__ztInstruction
if ($__ztExitCode -ne 0) {
  Write-Host 'Cursor Agent failed; retrying once...' -ForegroundColor Yellow
  Start-Sleep -Seconds 2
  $__ztExitCode = Invoke-ZenTaoCursorAgent $__ztInstruction
}
exit $__ztExitCode