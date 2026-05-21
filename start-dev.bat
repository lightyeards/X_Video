@echo off
setlocal
cd /d %~dp0

if not exist .env (
  copy /Y .env.example .env >nul
  echo Created .env from .env.example.
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Please run "npm install" manually.
    pause
    exit /b 1
  )
)

echo Checking existing dev services on ports 4399 and 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(4399, 5173);" ^
  "$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort };" ^
  "$pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "foreach ($processId in $pids) {" ^
  "  try {" ^
  "    Stop-Process -Id $processId -Force -ErrorAction Stop;" ^
  "    Write-Host ('Stopped process ' + $processId);" ^
  "  } catch {" ^
  "    Write-Host ('Skip process ' + $processId + ': ' + $_.Exception.Message);" ^
  "  }" ^
  "}"

timeout /t 2 /nobreak >nul
echo Starting frontend and backend dev services...
call npm run dev
