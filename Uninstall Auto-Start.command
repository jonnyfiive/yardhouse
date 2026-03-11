#!/bin/bash
# ============================================
# JUST NATION — Remove Yardhouse Auto-Start
# Run this to stop the server from
# auto-starting on login.
# ============================================

PLIST_DEST="$HOME/Library/LaunchAgents/com.justnation.yardhouse-server.plist"

echo ""
echo "  🛑 Removing Yardhouse auto-start..."
echo ""

if [ -f "$PLIST_DEST" ]; then
    launchctl unload "$PLIST_DEST" 2>/dev/null
    rm "$PLIST_DEST"
    echo "  ✅ Auto-start removed. Server will no longer start on login."
else
    echo "  ℹ️  Auto-start was not installed."
fi

echo ""
read -p "  Press Enter to close..."
