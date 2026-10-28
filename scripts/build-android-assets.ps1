# Generates the Android launcher icons and splash screens from resources/icon.png.
#
# The app icon is a rounded gradient square with five white bars. Android wants
# three different things from it:
#
#   ic_launcher.png           legacy square icon (pre-API 26 launchers)
#   ic_launcher_round.png     the same icon, cropped to a circle
#   ic_launcher_foreground    adaptive icon foreground: only the white bars,
#                             inside the 66dp safe zone, on a transparent canvas
#
# The adaptive background is a gradient drawable in res/drawable.
# Splash screens are the icon centred on the app's background colour.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/build-android-assets.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$iconPath = Join-Path $root 'resources/icon.png'
$res = Join-Path $root 'android/app/src/main/res'
$bg = [System.Drawing.ColorTranslator]::FromHtml('#0b0b10')

$source = [System.Drawing.Bitmap]::FromFile($iconPath)

# ------------------------------------------------------------------ helpers

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  return @{ Bitmap = $bmp; Graphics = $g }
}

function Save-Png($bmp, [string]$path) {
  $dir = Split-Path -Parent $path
  New-Item -ItemType Directory -Force $dir | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

# White bars only, transparent everywhere else. Bounding box of the bars.
function Get-Bars() {
  $minX = $source.Width; $minY = $source.Height; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
      $c = $source.GetPixel($x, $y)
      if ($c.A -gt 200 -and $c.R -gt 235 -and $c.G -gt 235 -and $c.B -gt 235) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -le $minX) { throw 'No white bars found in resources/icon.png' }

  $w = $maxX - $minX + 1
  $h = $maxY - $minY + 1
  $bars = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $source.GetPixel($x + $minX, $y + $minY)
      if ($c.A -gt 200 -and $c.R -gt 225 -and $c.G -gt 225 -and $c.B -gt 225) {
        $bars.SetPixel($x, $y, [System.Drawing.Color]::White)
      }
    }
  }
  return @{ Bitmap = $bars; Width = $w; Height = $h }
}

# Draws $src centred, scaled so its longer side is $size.
function Draw-Fitted($g, $src, [int]$canvas, [double]$size) {
  $scale = $size / [Math]::Max($src.Width, $src.Height)
  $w = [int][Math]::Round($src.Width * $scale)
  $h = [int][Math]::Round($src.Height * $scale)
  $x = [int](($canvas - $w) / 2)
  $y = [int](($canvas - $h) / 2)
  $g.DrawImage($src, $x, $y, $w, $h)
}

$bars = Get-Bars

# ------------------------------------------------------------------ launcher

$densities = @{
  'mdpi'    = @{ Dp = 48;  Foreground = 108 }
  'hdpi'    = @{ Dp = 72;  Foreground = 162 }
  'xhdpi'   = @{ Dp = 96;  Foreground = 216 }
  'xxhdpi'  = @{ Dp = 144; Foreground = 324 }
  'xxxhdpi' = @{ Dp = 192; Foreground = 432 }
}

foreach ($name in $densities.Keys) {
  $spec = $densities[$name]
  $dir = Join-Path $res "mipmap-$name"
  New-Item -ItemType Directory -Force $dir | Out-Null

  # Square icon.
  $square = New-Canvas $spec.Dp $spec.Dp
  $square.Graphics.DrawImage($source, 0, 0, $spec.Dp, $spec.Dp)
  Save-Png $square.Bitmap (Join-Path $dir 'ic_launcher.png')
  $square.Graphics.Dispose(); $square.Bitmap.Dispose()

  # Round icon: the same artwork, drawn slightly larger so the circle is filled
  # to its edge, then clipped.
  $round = New-Canvas $spec.Dp $spec.Dp
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(0, 0, $spec.Dp - 1, $spec.Dp - 1)
  $round.Graphics.SetClip($path)
  $overscan = [int]($spec.Dp * 0.12)
  $round.Graphics.DrawImage($source, -$overscan, -$overscan, $spec.Dp + 2 * $overscan, $spec.Dp + 2 * $overscan)
  Save-Png $round.Bitmap (Join-Path $dir 'ic_launcher_round.png')
  $round.Graphics.Dispose(); $round.Bitmap.Dispose(); $path.Dispose()

  # Adaptive foreground: bars inside the safe zone (66 of 108 dp).
  $fg = New-Canvas $spec.Foreground $spec.Foreground
  Draw-Fitted $fg.Graphics $bars.Bitmap $spec.Foreground ([Math]::Round($spec.Foreground * 0.58))
  Save-Png $fg.Bitmap (Join-Path $dir 'ic_launcher_foreground.png')
  $fg.Graphics.Dispose(); $fg.Bitmap.Dispose()
}

# ------------------------------------------------------------------ splash

# Icon at ~34% of the shorter side, centred on the app background.
function New-Splash([int]$w, [int]$h, [string]$path) {
  $canvas = New-Canvas $w $h
  $canvas.Graphics.Clear($bg)
  $side = [Math]::Min($w, $h) * 0.34
  Draw-Fitted $canvas.Graphics $source ([Math]::Min($w, $h)) ($side)
  Save-Png $canvas.Bitmap $path
  $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose()
}

New-Splash 2732 2732 (Join-Path $res 'drawable/splash.png')

$splashes = @{
  'port/mdpi'    = @(320, 480)
  'port/hdpi'    = @(480, 800)
  'port/xhdpi'   = @(720, 1280)
  'port/xxhdpi'  = @(960, 1600)
  'port/xxxhdpi' = @(1280, 1920)
  'land/mdpi'    = @(480, 320)
  'land/hdpi'    = @(800, 480)
  'land/xhdpi'   = @(1280, 720)
  'land/xxhdpi'  = @(1600, 960)
  'land/xxxhdpi' = @(1920, 1280)
}

foreach ($key in $splashes.Keys) {
  $parts = $key.Split('/')
  $size = $splashes[$key]
  $path = Join-Path $res ("drawable-$($parts[0])-$($parts[1])/splash.png")
  New-Splash $size[0] $size[1] $path
}

$bars.Bitmap.Dispose()
$source.Dispose()

# ------------------------------------------------------------------ adaptive background

# The icon's own gradient, as an Android drawable, so an adaptive icon (bars on
# top) has the same background as the square one.
$gradient = @"
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:angle="315"
        android:startColor="#7467FD"
        android:endColor="#2AC8F0"
        android:type="linear" />
</shape>
"@
Set-Content -Path (Join-Path $res 'drawable/ic_launcher_background.xml') -Value $gradient -Encoding UTF8

Write-Output 'Android icons and splash screens generated.'
