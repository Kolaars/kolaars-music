# Streams the WebView's console messages and uncaught exceptions for a few
# seconds, with real text instead of the "[object Object]" that
# `adb logcat -s Capacitor/Console` shows.
#
#   powershell -ExecutionPolicy Bypass -File scripts/android-logs.ps1 -Seconds 12

param(
  [int]$Seconds = 10,
  [int]$Port = 9222,
  [switch]$Reload
)

$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'E:\Android\sdk' }
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$pkg = 'app.kolaars.music'

$appPid = (& $adb shell pidof $pkg | Out-String).Trim()
if (-not $appPid) { throw "$pkg is not running. Start it on the phone first." }

& $adb forward "tcp:$Port" "localabstract:webview_devtools_remote_$appPid" | Out-Null

$target = (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 10 |
  Where-Object { $_.type -eq 'page' } | Select-Object -First 1)
if (-not $target) { throw 'No WebView page exposed by the app yet.' }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait(15000) | Out-Null

function Send-Cdp($id, $method, $params) {
  $payload = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
  $ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
}

function Format-RemoteObject($obj) {
  if ($null -eq $obj) { return '' }
  if ($obj.value -ne $null) { return [string]$obj.value }
  if ($obj.unserializableValue) { return [string]$obj.unserializableValue }
  if ($obj.description) { return [string]$obj.description }
  return [string]$obj.type
}

try {
  Send-Cdp 1 'Runtime.enable' @{}
  Send-Cdp 2 'Log.enable' @{}
  if ($Reload) { Send-Cdp 3 'Page.reload' @{ ignoreCache = $true } }

  $buffer = New-Object byte[] 262144
  $deadline = (Get-Date).AddSeconds($Seconds)

  while ((Get-Date) -lt $deadline) {
    $text = New-Object Text.StringBuilder
    do {
      $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
      $receive = $ws.ReceiveAsync($segment, [Threading.CancellationToken]::None)
      if (-not $receive.Wait(1000)) { break }
      $result = $receive.Result
      [void]$text.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
    } while (-not $result.EndOfMessage)
    if ($text.Length -eq 0) { continue }

    $message = $text.ToString() | ConvertFrom-Json
    switch ($message.method) {
      'Runtime.consoleAPICalled' {
        $args = ($message.params.args | ForEach-Object { Format-RemoteObject $_ }) -join ' '
        Write-Output ("[{0}] {1}" -f $message.params.type, $args)
      }
      'Runtime.exceptionThrown' {
        $d = $message.params.exceptionDetails
        $desc = if ($d.exception) { $d.exception.description } else { $d.text }
        Write-Output ("[exception] {0}" -f $desc)
      }
      'Log.entryAdded' {
        $e = $message.params.entry
        Write-Output ("[log:{0}] {1} {2}" -f $e.level, $e.text, $e.url)
      }
      default { }
    }
  }
} finally {
  $ws.Dispose()
}
