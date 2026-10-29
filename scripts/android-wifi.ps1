# Switches adb from USB to Wi-Fi for the connected phone.
#
# `adb tcpip 5555` needs a USB connection once (per reboot); afterwards the
# device is reachable as <phone-ip>:5555 and the cable can be unplugged.
#
#   powershell -ExecutionPolicy Bypass -File scripts/android-wifi.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/android-wifi.ps1 -WaitSeconds 300

param(
  [int]$WaitSeconds = 240,
  [int]$Port = 5555
)

$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'E:\Android\sdk' }
$adb = Join-Path $sdk 'platform-tools/adb.exe'

& $adb start-server | Out-Null

# 1. Wait for the USB connection (the only way to enable tcpip).
$serial = $null
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  $line = (& $adb devices) | Where-Object { $_ -match '^\S+\s+device$' } | Select-Object -First 1
  if ($line -match '^(\S+)\s+device$') { $serial = $Matches[1]; break }
  Start-Sleep -Seconds 2
}
if (-not $serial) { throw "Телефон не найден по USB за $WaitSeconds с. Подключите кабель." }
Write-Output "usb: $serial"

# 2. Find the phone's Wi-Fi address.
$ip = (& $adb -s $serial shell ip -4 addr show wlan0 |
  Select-String -Pattern 'inet\s+(\d+\.\d+\.\d+\.\d+)' |
  ForEach-Object { $_.Matches[0].Groups[1].Value } |
  Select-Object -First 1)
if (-not $ip) { throw 'У телефона нет адреса в Wi-Fi (wlan0). Включите Wi-Fi.' }
Write-Output "wlan0: $ip"

# 3. Restart adbd in TCP mode and reconnect over the network.
& $adb -s $serial tcpip $Port | Out-Null
Start-Sleep -Seconds 3
for ($i = 0; $i -lt 10; $i++) {
  & $adb connect "${ip}:$Port" | Out-Null
  Start-Sleep -Seconds 1
  if ((& $adb devices) -match "^${ip}:$Port\s+device$") { break }
}

& $adb devices -l

# 4. Report what is installed, so a stale APK cannot go unnoticed.
$pkg = 'app.kolaars.music'
$dump = & $adb -s "${ip}:$Port" shell dumpsys package $pkg
$versionName = ($dump | Select-String -Pattern 'versionName=(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value
$versionCode = ($dump | Select-String -Pattern 'versionCode=(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value
$updated = ($dump | Select-String -Pattern 'lastUpdateTime=(.+)' | Select-Object -First 1).Matches[0].Groups[1].Value
$firstInstall = ($dump | Select-String -Pattern 'firstInstallTime=(.+)' | Select-Object -First 1).Matches[0].Groups[1].Value
Write-Output "installed: $pkg $versionName ($versionCode)"
Write-Output "first install: $firstInstall"
Write-Output "last update:   $updated"
Write-Output "pid:           $((& $adb -s "${ip}:$Port" shell pidof $pkg | Out-String).Trim())"
