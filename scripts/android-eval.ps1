# Evaluates a JavaScript expression inside the running app's WebView and prints
# the result as JSON. Uses the Chrome DevTools Protocol over an adb forward, so
# no Chrome window or emulator is needed.
#
#   powershell -ExecutionPolicy Bypass -File scripts/android-eval.ps1 -Expression "document.title"
#   powershell -ExecutionPolicy Bypass -File scripts/android-eval.ps1 -Expression "(async()=>await window.kolaars.app.info())()"
#
# The expression may return a promise; it is awaited.

param(
  [Parameter(Mandatory = $true)][string]$Expression,
  [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'E:\Android\sdk' }
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$pkg = 'app.kolaars.music'

$appPid = (& $adb shell pidof $pkg | Out-String).Trim()
if (-not $appPid) { throw "$pkg is not running. Start it on the phone first." }

& $adb forward "tcp:$Port" "localabstract:webview_devtools_remote_$appPid" | Out-Null

$targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 10
$target = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
if (-not $target) { throw 'No WebView page exposed by the app yet.' }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait(15000) | Out-Null

try {
  $payload = @{
    id     = 1
    method = 'Runtime.evaluate'
    params = @{
      expression    = $Expression
      returnByValue = $true
      awaitPromise  = $true
      userGesture   = $true
    }
  } | ConvertTo-Json -Depth 8 -Compress

  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $send = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
  $ws.SendAsync($send, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(15000) | Out-Null

  $buffer = New-Object byte[] 262144
  $text = New-Object Text.StringBuilder
  do {
    $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
    $result = $ws.ReceiveAsync($segment, [Threading.CancellationToken]::None).Result
    [void]$text.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
  } while (-not $result.EndOfMessage)

  $response = $text.ToString() | ConvertFrom-Json
  if ($response.result.exceptionDetails) {
    $detail = $response.result.exceptionDetails
    throw "JS error: $($detail.text) $($detail.exception.description)"
  }
  $value = $response.result.result.value
  if ($null -eq $value) {
    Write-Output $response.result.result.description
  } else {
    $value | ConvertTo-Json -Depth 8
  }
} finally {
  $ws.Dispose()
}
