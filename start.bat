@echo off
REM =====================================================================
REM  My Planner - start.bat (Portable version)
REM  Runs the local server and opens the browser.
REM  No installation needed: uses the portable Python in the python\ folder.
REM  NOTE: keep this file ASCII-only (no Persian text) - cmd.exe misparses
REM  multi-byte characters inside .bat files.
REM =====================================================================

chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1

REM --- find Python: portable first, then virtual environment ---
set "PYEXE="
if exist "python\python.exe" set "PYEXE=python\python.exe"
if not defined PYEXE if exist ".venv\Scripts\python.exe" set "PYEXE=.venv\Scripts\python.exe"

if not defined PYEXE (
    echo [ERROR] Python not found.
    echo Portable python must exist at:  python\python.exe
    echo or virtual environment at:      .venv\Scripts\python.exe
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================================
echo   My Planner
echo ==========================================================
echo Using Python:  %PYEXE%
echo.
echo Server:  http://127.0.0.1:8000
echo.
echo The browser will open automatically in a few seconds.
echo To STOP the server press  Ctrl + C  in this window.
echo.

REM Open the browser with a 3-second delay so the server has time to start.
REM (Older versions opened the browser before the server was ready.)
start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:8000"

REM Run the server with the Python we found
"%PYEXE%" backend\main.py

echo.
echo Server stopped.
pause
