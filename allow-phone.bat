@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>&1
echo ============================================================
echo   Allow phone to reach the preview server (port 3000)
echo ============================================================
echo.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo   [!] Administrator rights required.
  echo   [!] Close this window, RIGHT-CLICK this file and choose
  echo   [!] "Run as administrator".
  echo.
  pause
  exit /b 1
)
echo Adding inbound rule for TCP port 3000 on all network types...
netsh advfirewall firewall delete rule name="YaoShiTong 3000 TCP In" >nul 2>&1
netsh advfirewall firewall add rule name="YaoShiTong 3000 TCP In" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.
echo   [OK] Done. Now double-click preview.bat (the other
echo        .bat file in this folder). It prints the address for
echo        your phone, for example http://10.0.0.5:3000
echo.
echo   Phone must be on the same Wi-Fi as this computer.
echo.
echo   To undo this change later, run as administrator:
echo        netsh advfirewall firewall delete rule name="YaoShiTong 3000 TCP In"
echo.
pause
