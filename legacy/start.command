#!/bin/bash
# Just Nation — Daily Briefing Server
# Double-click this file to start the dashboard with AI chat

cd "$(dirname "$0")"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   JUST NATION — Daily Briefing        ║"
echo "  ║   Starting server...                  ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# Check for .env
if [ ! -f .env ]; then
    echo "⚠️  No .env file found!"
    echo "   Create .env with: ANTHROPIC_API_KEY=sk-ant-your-key-here"
    echo ""
    echo "   Get your key at: https://console.anthropic.com/keys"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# Install dependencies quietly
echo "→ Checking dependencies..."
pip3 install -q flask flask-cors anthropic python-dotenv requests 2>/dev/null

# Open browser after a short delay
(sleep 2 && open http://localhost:5050) &

# Start server
echo "→ Server starting at http://localhost:5050"
echo "→ Press Ctrl+C to stop"
echo ""
python3 server/app.py
