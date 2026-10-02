@echo off
echo [step 1/7] batch started. Press any key to enter project folder...
pause
cd /d "%~dp0"
echo [step 2/7] now in folder: %cd%
echo [step 2/7] Press any key to check Node.js...
pause

node --version >nul 2>&1
if errorlevel 1 (
  echo   [!] node.exe not found in PATH.
  echo   [!] Please install Node.js 20 LTS (64-bit) and reopen this folder.
  pause
  exit /b 1
)
echo [step 3/7] node found.
npm --version >nul 2>&1
if errorlevel 1 (
  echo   [!] npm.exe not found in PATH.
  echo   [!] Please reinstall Node.js.
  pause
  exit /b 1
)
echo [step 3/7] npm found. Press any key to check .env.local...
pause

if not exist ".env.local" (
  echo   [!] .env.local NOT FOUND
  echo   The page will still open, but photo recognition and voice reading will show an error message.
  echo   To enable the full demo: copy .env.local.example to .env.local and fill in the keys.
  pause
)
echo [step 4/7] .env.local check done. Press any key to get LAN IP...
pause

set "LANIP="
for /f "delims=" %%i in ('node scripts\lan-ip.js 2^>nul') do set "LANIP=%%i"
echo   On this computer : http://localhost:3000
if defined LANIP (
  echo   On your phone    : http://%LANIP%:3000
) else (
  echo   On your phone    : run ipconfig and use the WLAN IPv4, port 3000
)
echo [step 5/7] Press any key to build (skip if already built)...
pause

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
echo [step 6/7] build OK. Press any key to start the server...
pause

echo Starting the preview server in the background...
echo   (logs are written to server.log in this folder)
if exist "server.log" del /f /q "server.log"
start /b npm run start > "server.log" 2>&1
echo [step 7/7] server started. Waiting 6 seconds for it to be ready...
timeout /t 6 /nobreak > nul

curl -s -o /dev/null -w "%%{http_code}" http://localhost:3000 > "server.httpcode" 2>nul
set /p HTTP_CODE=<"server.httpcode"
del /f /q "server.httpcode" 2>nul
if "%HTTP_CODE%"=="200" (
  start "" http://localhost:3000
  echo.
  echo Browser opened at http://localhost:3000
  echo Server is running in this window. To stop: close this window.
) else (
  echo.
  echo   [!] Server does not seem to have started (HTTP code: %HTTP_CODE%).
  echo   [!] Last lines of server.log:
  if exist "server.log" (
    echo --------------------------------------------------
    type "server.log"
    echo --------------------------------------------------
  ) else (
    echo   (server.log not found)
  )
)
echo.
pause
