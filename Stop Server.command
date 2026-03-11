#!/bin/bash
# ============================================
# JUST NATION — Stop Yardhouse Server
# Double-click to stop the running server
# ============================================

echo ""
echo "  🛑 Stopping Yardhouse server..."
echo ""

PID=$(lsof -ti :5050 2>/dev/null)

if [ -z "$PID" ]; then
    echo "  ℹ️  Server is not running."
else
    kill $PID 2>/dev/null
    sleep 1
    # Force kill if still running
    if lsof -i :5050 -sTCP:LISTEN >/dev/null 2>&1; then
        kill -9 $PID 2>/dev/null
    fi
    echo "  ✅ Server stopped."
fi

echo ""
read -p "  Press Enter to close..."
