#!/bin/bash
# ============================================
# JUST NATION — Yardhouse Server Starter
# Double-click this file to start the server
# ============================================

cd "$(dirname "$0")"
echo ""
echo "  🏗️  JUST NATION — Yardhouse Dashboard Server"
echo "  ============================================"
echo ""

# Create logs dir if needed
mkdir -p logs

# Check if server is already running
if lsof -i :5050 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ⚠️  Server is already running on port 5050."
    echo ""
    echo "  To restart, first run: Stop Server.command"
    echo ""
    read -p "  Press Enter to close..."
    exit 0
fi

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "  ❌ Python3 not found. Install it from python.org"
    read -p "  Press Enter to close..."
    exit 1
fi

# Check required packages
python3 -c "import flask" 2>/dev/null || {
    echo "  📦 Installing required packages..."
    pip3 install flask flask-cors requests python-dotenv --break-system-packages 2>/dev/null || \
    pip3 install flask flask-cors requests python-dotenv
}

echo "  ✅ Starting server on http://localhost:5050"
echo "  📋 Logs: logs/server.log"
echo ""
echo "  Close this window or press Ctrl+C to stop."
echo "  ============================================"
echo ""

python3 dashboard_server.py 2>&1 | tee logs/server.log
