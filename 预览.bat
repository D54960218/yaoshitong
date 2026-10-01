@echo off
cd /d "%~dp0"
echo ============================================================
echo   YaoShiTong - Local Preview (production mode)
echo ============================================================
echo.
if not exist ".env.local" (
  echo   [!] .env.local NOT FOUND
  echo.
  echo   The page will still open, but photo recognition and
  echo   voice reading will show an error message.
  echo.
  echo   To enable the full demo:
  echo     1. copy  .env.local.example  to  .env.local
  echo     2. fill in ZHIPU_API_KEY and MINIMAX_API_KEY
  echo     ^(see README.md for how to apply^)
  echo.
  pause
)
set "LANIP="
for /f "delims=" %%i in ('node scripts\lan-ip.js 2^>nul') do set "LANIP=%%i"
echo   On this computer : http://localhost:3000
if defined LANIP (
  echo   On your phone    : http://%LANIP%:3000
  echo                      ^(phone must be on the same Wi-Fi^)
) else (
  echo   On your phone    : run  ipconfig  and use the WLAN IPv4, port 3000
)
echo.
if not exist ".next\BUILD_ID" (
  echo   Building production version (about 40 seconds, only needed once)...
  call npm run build
  if errorlevel 1 (
    echo.
    echo   Build FAILED - please copy the error message above.
    pause
    exit /b 1
  )
)
echo Starting the preview server in a new window...
start "YaoShiTong-Preview" cmd /k npm run start
echo Waiting for the server to be ready...
timeout /t 6 /nobreak > nul
start "" http://localhost:3000
echo.
echo Browser opened at http://localhost:3000
echo Keep the "YaoShiTong-Preview" window open while using it.
echo To stop: just close that window.
echo After changing the code, delete the .next folder to force a rebuild.
echo.
pause
