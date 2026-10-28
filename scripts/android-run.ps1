# Installs the debug APK on the connected phone and shows what it logs.
#
#   powershell -ExecutionPolicy Bypass -File scripts/android-run.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/android-run.ps1 -Logs
#
# Requires USB debugging enabled and the PC authorised in the phone's "Allow USB
# debugging?" dialog. Emulators are not used.

param(
  [switch]$Logs,
  [int]$Seconds = 8
)

$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif (Test-Path 'E:\Android\sdk') { 'E:\Android\sdk' } else { $null }
if (-not $sdk) { throw 'Android SDK not found. Set ANDROID_HOME or install it to E:\Android\sdk.' }

$adb = Join-Path $sdk 'platform-tools/adb.exe'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$apk = Join-Path $root 'android/app/build/outputs/apk/debug/app-debug.apk'
$pkg = 'app.kolaars.music'

$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S' }
if (-not $devices) {
  throw 'No Android device. Connect the phone, enable USB debugging, and accept the prompt on the phone.'
}
$devices | ForEach-Object { Write-Output "device: $_" }

if (-not (Test-Path $apk)) { throw "APK not built yet: $apk" }

Write-Output "installing $apk"
& $adb install -r $apk

if ($Logs) {
  & $adb logcat -c
}

& $adb shell am start -n "$pkg/.MainActivity"

if ($Logs) {
  Start-Sleep -Seconds $Seconds
  & $adb logcat -d -s Capacitor/Console:V Capacitor:V chromium:V AndroidRuntime:E System.err:W `
    | Where-Object { $_ -match 'kolaars|Capacitor|chromium|AndroidRuntime|FATAL|Error|error' } `
    | Select-Object -Last 120
}
