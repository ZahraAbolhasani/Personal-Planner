@echo off
REM =====================================================================
REM  My Planner - setup.bat
REM  نصب پیش‌نیازها: ساخت محیط مجازی و نصب کتابخانه‌های پایتون.
REM  این فایل را فقط «یک بار» اجرا کنید. برای نصب به اینترنت نیاز است.
REM =====================================================================

chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1

echo.
echo ==========================================================
echo   My Planner - Setup
echo ==========================================================
echo.

REM --- پیدا کردن پایتون ---
set "PY="
py -3 --version >nul 2>nul
if %errorlevel%==0 set "PY=py -3"

if not defined PY (
    python --version >nul 2>nul
    if %errorlevel%==0 set "PY=python"
)

if not defined PY (
    echo [ERROR] Python was not found on this system.
    echo Install Python 3.10 or newer from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo [1/3] Using Python:
%PY% --version

REM --- ساخت محیط مجازی ---
if exist ".venv\Scripts\python.exe" (
    echo [2/3] Virtual environment already exists. Skipping creation.
) else (
    echo [2/3] Creating virtual environment in .venv ...
    %PY% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Could not create virtual environment.
        pause
        exit /b 1
    )
)

REM --- نصب وابستگی‌ها ---
echo [3/3] Installing dependencies (this needs an internet connection) ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Installing dependencies failed.
    echo Check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo ==========================================================
echo   Setup finished successfully.
echo   Now run  start.bat  to launch the app.
echo ==========================================================
echo.
pause
