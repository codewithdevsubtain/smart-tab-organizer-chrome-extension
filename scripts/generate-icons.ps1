Add-Type -AssemblyName System.Drawing

function Save-Icon {
  param([int]$Size, [string]$Path)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::FromArgb(12, 15, 20))
  $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(99, 102, 241),
    [System.Drawing.Color]::FromArgb(168, 85, 247),
    45
  )
  $margin = [int]($Size * 0.18)
  $inner = $Size - 2 * $margin
  $g.FillRectangle($brush, $margin, $margin, $inner, $inner)
  $penWidth = [Math]::Max(1, [int]($Size / 16))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(240, 240, 255), $penWidth)
  $tabW = [int]($Size * 0.22)
  $tabH = [int]($Size * 0.14)
  for ($i = 0; $i -lt 3; $i++) {
    $x = $margin + 4 + $i * ($tabW - 4)
    $y = $margin + 6 + $i * ($tabH - 2)
    $g.DrawRectangle($pen, $x, $y, $tabW, $tabH)
  }
  $g.Dispose()
  $brush.Dispose()
  $pen.Dispose()
  $dir = Split-Path $Path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$root = Split-Path $PSScriptRoot -Parent
Save-Icon -Size 16 -Path (Join-Path $root 'icons\icon16.png')
Save-Icon -Size 48 -Path (Join-Path $root 'icons\icon48.png')
Save-Icon -Size 128 -Path (Join-Path $root 'icons\icon128.png')
Write-Host 'Icons created in icons/'
