@echo off
cd /d "%~dp0"
echo ============================================================
echo   Fill in your API keys
echo ============================================================
echo.
if not exist ".env.local" (
  copy /y ".env.local.example" ".env.local" >nul
  echo   Created .env.local from the example file.
  echo.
)
echo   Notepad will open the file:  .env.local
echo.
echo   Replace the Chinese placeholders after the "=" signs with
echo   your real keys:
echo.
echo     ZHIPU_API_KEY   from  https://open.bigmodel.cn
echo     MINIMAX_API_KEY from  https://platform.minimaxi.com
echo     MINIMAX_GROUP_ID  (same page as MiniMax API Key)
echo.
echo   Then: save the file (Ctrl+S), close Notepad, and restart
echo   the preview by running the preview launcher again.
echo.
echo   Apply keys (how to register) is also written in README.md
echo.
pause
start "" notepad "%~dp0.env.local"
