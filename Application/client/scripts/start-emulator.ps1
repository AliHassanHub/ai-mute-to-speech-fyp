# Reliable Android emulator + Expo Go startup on Windows
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Free port 8081
Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

adb devices | Select-String "emulator" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Start the Android emulator (Pixel_6) first." -ForegroundColor Red
  exit 1
}

adb reverse tcp:8081 tcp:8081
Write-Host "Metro: use exp://127.0.0.1:8081 in Expo Go (adb reverse is active)." -ForegroundColor Cyan
Write-Host "Do NOT use --localhost on Windows (breaks IPv4)." -ForegroundColor Yellow
npx expo start
