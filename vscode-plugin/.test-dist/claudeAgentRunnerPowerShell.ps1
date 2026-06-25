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
}
$__ztPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path
$__ztWorkspace = (Get-Location).Path
function Invoke-ZenTaoClaudeAgent {
  param([string]$Instruction)
  $state = @{ printed = $false; openLine = $false; busyLine = $false; busyFlag = ''; busyProcess = $null; lastText = ''; streamedText = ''; toolTotal = 0; toolSeen = @{}; toolParts = @{}; thinkingChars = 0; lastThinkingLog = 0 }
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
  function Input-Value {
    param($InputObject, [string[]]$Names)
    if (-not $InputObject) { return '' }
    foreach ($name in $Names) {
      if ($InputObject.PSObject.Properties.Name -contains $name) { return [string]$InputObject.PSObject.Properties[$name].Value }
    }
    return ''
  }
  function Tool-Summary {
    param($Part)
    $name = [string]$Part.name
    $input = $Part.input
    $path = Input-Value $input @('file_path', 'path')
    $pattern = Input-Value $input @('pattern', 'query', 'glob', 'regex')
    $command = Input-Value $input @('command', 'cmd')
    if ($name -eq 'Read') { if ($path) { return 'Read ' + (Shorten-Path $path) }; return 'Read pending' }
    if ($name -eq 'Grep') { if ($pattern) { return 'Grepped ' + (Shorten-Text $pattern 120) }; return 'Grepped pending' }
    if ($name -eq 'Glob') { if ($pattern) { return 'Searched files ' + (Shorten-Text $pattern 120) }; return 'Searched files pending' }
    if ($name -eq 'Edit' -or $name -eq 'MultiEdit' -or $name -eq 'Write') { return $name + ' ' + (Shorten-Path $path) }
    if ($name -eq 'Bash') { return 'Ran ' + (Shorten-Text $command 120) }
    if ($name) { return $name }
    return 'Tool'
  }
  function Write-AssistantText {
    param([string]$Text)
    if (-not $Text) { return }
    Clear-BusyLine
    $shouldBreakBeforeDelta = $false
    if ($state.lastText -and $Text.StartsWith($state.lastText)) {
      $delta = $Text.Substring($state.lastText.Length)
    } elseif ($state.streamedText -and $Text.StartsWith($state.streamedText)) {
      $delta = $Text.Substring($state.streamedText.Length)
    } elseif ($Text -eq $state.lastText) {
      $delta = ''
    } elseif ($state.streamedText -and $state.streamedText.EndsWith($Text)) {
      $delta = ''
    } elseif ($Text.Length -le 120 -and -not $Text.Contains("`n")) {
      $delta = $Text
    } else {
      $shouldBreakBeforeDelta = $true
      $delta = $Text
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
    $state.lastText = $Text
  }
  function Write-ActivityLog {
    param([string]$Text)
    if (-not $Text) { return }
    Clear-BusyLine
    if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }
    Write-Host $Text -ForegroundColor DarkGray
    Show-BusyLine
  }
  $__ztErrFile = [System.IO.Path]::GetTempFileName()
  try {
  Show-BusyLine 'Claude starting'
  claude -p --verbose --permission-mode acceptEdits --output-format stream-json --include-partial-messages $Instruction 2> $__ztErrFile | ForEach-Object {
    $line = [string]$_
    try {
      $event = $line | ConvertFrom-Json -ErrorAction Stop
      if ($event.type -eq 'system' -and $event.subtype -eq 'init') {
        Clear-BusyLine
        Write-Host ('[Claude] model=' + $event.model + ' cwd=' + $event.cwd) -ForegroundColor DarkGray
        Show-BusyLine 'Claude thinking'
      } elseif ($event.type -eq 'system' -and $event.subtype -eq 'status') {
        if (-not $state.openLine) { Show-BusyLine 'Claude requesting model' }
      } elseif ($event.type -eq 'stream_event') {
        $inner = $event.event
        if ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'text_delta') {
          Write-AssistantText ([string]$inner.delta.text)
        } elseif ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'thinking_delta') {
          $state.thinkingChars = [int]$state.thinkingChars + ([string]$inner.delta.thinking).Length
          if (($state.thinkingChars - [int]$state.lastThinkingLog) -ge 120) {
            $state.lastThinkingLog = $state.thinkingChars
            Write-ActivityLog ('Thinking... ' + $state.thinkingChars + ' chars')
          }
        } elseif ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'input_json_delta') {
          $indexKey = [string]$inner.index
          if ($state.toolParts.ContainsKey($indexKey)) {
            $tool = $state.toolParts[$indexKey]
            $tool.inputJson = [string]$tool.inputJson + [string]$inner.delta.partial_json
            try {
              $input = $tool.inputJson | ConvertFrom-Json -ErrorAction Stop
              $partObject = [pscustomobject]@{ name = $tool.name; input = $input }
              $detailKey = $tool.id + ':detail'
              $detailSummary = Tool-Summary $partObject
              if (-not $state.toolSeen.ContainsKey($detailKey)) {
                if ($detailSummary -notmatch 'pending$') {
                  Write-ActivityLog $detailSummary
                  $state.toolSeen[$detailKey] = $true
                }
              }
            } catch {}
          }
        } elseif ($inner.type -eq 'content_block_start' -and $inner.content_block -and $inner.content_block.type -eq 'tool_use') {
          $indexKey = [string]$inner.index
          $toolId = [string]$inner.content_block.id
          if (-not $toolId) { $toolId = ([string]$inner.content_block.name) + ':' + $state.toolTotal }
          $state.toolParts[$indexKey] = @{ id = $toolId; name = [string]$inner.content_block.name; inputJson = '' }
          if (-not $state.toolSeen.ContainsKey($toolId)) {
            $state.toolSeen[$toolId] = $true
            $state.toolTotal = [int]$state.toolTotal + 1
            Clear-BusyLine
            if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }
            $busyText = 'Tool ' + [string]$inner.content_block.name
            if (-not [string]$inner.content_block.name) { $busyText = 'AI working' }
            Show-BusyLine $busyText
          }
        } elseif ($inner.type -eq 'message_start') {
          if (-not $state.openLine) { Show-BusyLine 'Claude generating' }
        }
      } elseif ($event.type -eq 'assistant') {
        foreach ($part in @($event.message.content)) {
          if ($part.type -eq 'text' -and $part.text) {
            Write-AssistantText ([string]$part.text)
          } elseif ($part.type -eq 'tool_use') {
            $toolId = [string]$part.id
            if (-not $toolId) { $toolId = ([string]$part.name) + ':' + $state.toolTotal }
            $summary = Tool-Summary $part
            if (-not $state.toolSeen.ContainsKey($toolId)) {
              $state.toolSeen[$toolId] = $true
              $state.toolTotal = [int]$state.toolTotal + 1
              if ($summary -notmatch 'pending$') { Write-ActivityLog $summary }
            } elseif ($part.input) {
              $detailKey = $toolId + ':detail'
              if (-not $state.toolSeen.ContainsKey($detailKey)) {
                if ($summary -notmatch 'pending$') { Write-ActivityLog $summary }
                $state.toolSeen[$detailKey] = $true
              }
            }
          }
        }
      } elseif ($event.type -eq 'result') {
        Clear-BusyLine
        if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }
        if (-not $state.printed -and $event.result) { Write-Host $event.result }
        if ($state.toolTotal -gt 0) { Write-Host ('Tools total: ' + $state.toolTotal + ' calls') -ForegroundColor DarkGray }
        if ($event.is_error) {
          Write-Host ('[Claude] failed duration=' + $event.duration_ms + 'ms') -ForegroundColor Red
        } else {
          Write-Host ('[Claude] done duration=' + $event.duration_ms + 'ms') -ForegroundColor DarkGray
        }
      }
    } catch {
      if ($line -and -not $line.TrimStart().StartsWith('{')) {
        Clear-BusyLine
        if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }
        Write-Host $line
      }
    }
  }
  Clear-BusyLine
  if ($state.openLine) { [Console]::WriteLine() }
  $__ztExit = $LASTEXITCODE
  if ($__ztExit -ne 0) {
    $err = ''
    try { $err = [System.IO.File]::ReadAllText($__ztErrFile, [System.Text.Encoding]::UTF8).Trim() } catch {}
    if ($err) {
      $lines = @($err -split '\r?\n' | Where-Object { $_ -and $_ -notmatch '^\s*\+ ' -and $_ -notmatch '^\s*~' -and $_ -notmatch '^\s*CategoryInfo' -and $_ -notmatch '^\s*FullyQualifiedErrorId' } | Select-Object -First 8)
      Write-Host '[Claude] error:' -ForegroundColor Red
      Write-Host ($lines -join "`n") -ForegroundColor Red
    }
  }
  return $__ztExit
  } finally {
    Remove-Item -LiteralPath $__ztErrFile -Force -ErrorAction SilentlyContinue
  }
}
$__ztExitCode = Invoke-ZenTaoClaudeAgent $__ztInstruction
if ($__ztExitCode -ne 0) {
  Write-Host 'Claude failed; retrying once...' -ForegroundColor Yellow
  Start-Sleep -Seconds 2
  $__ztExitCode = Invoke-ZenTaoClaudeAgent $__ztInstruction
}
exit $__ztExitCode