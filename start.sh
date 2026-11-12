#!/usr/bin/env bash
# =====================================================================
#  My Planner - start.sh (Linux / macOS)
#  Runs the local server and opens the browser.
#  The portable python/ folder is Windows-only. On Linux/macOS the
#  system python3 is used (usually preinstalled). First run needs
#  internet once to install the requirements into a local .venv.
#  Usage:  bash start.sh
# =====================================================================

set -e
cd "$(dirname "$0")"
export PYTHONUTF8=1

PY=python3
if ! command -v $PY >/dev/null 2>&1; then
    echo "[ERROR] python3 not found. Please install Python 3.10 or newer."
    exit 1
fi

echo "=========================================================="
echo "  My Planner"
echo "=========================================================="
echo "Using Python: $($PY --version 2>&1)"
echo

# --- create the virtual environment on first run ---
if [ ! -x ".venv/bin/python" ]; then
    echo "[1/2] Creating virtual environment (.venv) ..."
    $PY -m venv .venv
else
    echo "[1/2] Virtual environment already exists."
fi

# --- install dependencies (first run needs internet) ---
echo "[2/2] Installing dependencies (first run needs internet) ..."
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

echo
echo "Server:  http://127.0.0.1:8000"
echo "The browser opens automatically in a few seconds."
echo "To STOP the server press  Ctrl + C  in this window."
echo

# --- open the browser after a short delay (Linux: xdg-open, macOS: open) ---
(
    sleep 3
    if [ "$(uname)" = "Darwin" ]; then
        open "http://127.0.0.1:8000"
    else
        xdg-open "http://127.0.0.1:8000" >/dev/null 2>&1 || true
    fi
) &

# --- run the server ---
.venv/bin/python backend/main.py

echo
echo "Server stopped."
