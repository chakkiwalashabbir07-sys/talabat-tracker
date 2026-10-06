@echo off
title Push Talabat Tracker to GitHub
echo ===================================================
echo   Pushing Talabat Tracker to GitHub...
echo ===================================================
cd /d "%~dp0"
"C:\Program Files\Git\cmd\git.exe" push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo ===================================================
    echo   [SUCCESS] Code successfully pushed to GitHub!
    echo ===================================================
) else (
    echo ===================================================
    echo   [NOTE] If a browser window opened, click 'Authorize'.
    echo   Then press any key to try again.
    echo ===================================================
)
echo.
pause
