#!/bin/bash
# ============================================
# JUST NATION — Install Yardhouse Auto-Start
# Run this ONCE to make the server start
# automatically every time you log in.
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.justnation.yardhouse-server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.justnation.yardhouse-server.plist"

echo ""
echo "  🏗️  JUST NATION — Auto-Start Installer"
echo "  ========================================"
echo ""

# Create logs directory
mkdir -p "$SCRIPT_DIR/logs"

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$HOME/Library/LaunchAgents"

# Unload existing service if present
launchctl unload "$PLIST_DEST" 2>/dev/null

# Copy the plist and update the working directory to match actual location
sed "s|/Users/jonathancrespo/Claude/Work/Projects/Pallet Operations/Yardhouse|$SCRIPT_DIR|g" \
    "$PLIST_SRC" > "$PLIST_DEST"

# Also update the log paths
sed -i '' "s|/Users/jonathancrespo/Claude/Work/Projects/Pallet Operations/Yardhouse/logs|$SCRIPT_DIR/logs|g" \
    "$PLIST_DEST"

# Load the service
launchctl load "$PLIST_DEST"

echo "  ✅ Auto-start installed!"
echo ""
echo "  The Yardhouse server will now:"
echo "    • Start automatically when you log in"
echo "    • Restart automatically if it crashes"
echo "    • Log output to: $SCRIPT_DIR/logs/"
echo ""

# Check if it started
sleep 2
if lsof -i :5050 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  🟢 Server is running on http://localhost:5050"
else
    echo "  ⏳ Server is starting up..."
    echo "     If it doesn't come up, check: $SCRIPT_DIR/logs/server-error.log"
fi

echo ""
read -p "  Press Enter to close..."
