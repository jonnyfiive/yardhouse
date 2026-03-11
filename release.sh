#!/bin/bash
# Yardhouse Release Script
# Usage:
#   ./release.sh patch    — 1.0.0 → 1.0.1 (bug fixes)
#   ./release.sh minor    — 1.0.0 → 1.1.0 (new features)
#   ./release.sh major    — 1.0.0 → 2.0.0 (breaking changes)
#   ./release.sh          — defaults to patch

set -e

cd "$(dirname "$0")"

BUMP="${1:-patch}"
CURRENT=$(node -p "require('./package.json').version")

# Bump version
npm version "$BUMP" --no-git-tag-version
NEW=$(node -p "require('./package.json').version")

echo ""
echo "=== Yardhouse Release ==="
echo "  Version: $CURRENT → $NEW"
echo "  Building signed DMG + ZIP..."
echo ""

# --- GitHub auth ---
GH_TOKEN=$(gh auth token 2>/dev/null || echo "")

if [ -z "$GH_TOKEN" ]; then
  echo "ERROR: GitHub CLI not authenticated."
  echo "Run: gh auth login"
  exit 1
fi

export GH_TOKEN

# --- Apple notarization credentials ---
# These are required for code signing + notarization.
# APPLE_ID           = your Apple Developer email
# APPLE_APP_SPECIFIC_PASSWORD = app-specific password from appleid.apple.com
# APPLE_TEAM_ID      = 10-char Team ID from Apple Developer portal
#
# You can also export these in your shell profile (~/.zshrc) to avoid
# being prompted every time.

if [ -z "$APPLE_ID" ]; then
  echo "WARNING: APPLE_ID not set. Notarization will be skipped."
  echo "  To enable: export APPLE_ID=your@apple.email"
  echo ""
fi

if [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
  echo "WARNING: APPLE_APP_SPECIFIC_PASSWORD not set. Notarization will be skipped."
  echo "  To enable: export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx"
  echo "  Generate one at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords"
  echo ""
fi

if [ -z "$APPLE_TEAM_ID" ]; then
  echo "WARNING: APPLE_TEAM_ID not set. Notarization will be skipped."
  echo "  To enable: export APPLE_TEAM_ID=YOUR_TEAM_ID"
  echo ""
fi

# Build + publish (electron-builder handles signing + notarization automatically
# when the env vars above are set and a valid Developer ID cert is in Keychain)
npm run release

# electron-builder creates drafts — publish them so auto-updater can see them
echo ""
echo "Publishing release v$NEW..."

# Try the expected tag name first
if gh release edit "v$NEW" --repo jonnyfiive/yardhouse --draft=false 2>&1; then
  echo "Published v$NEW"
else
  echo "Tag v$NEW not found, searching for draft release..."
  # electron-builder sometimes creates untagged releases — find the latest draft
  DRAFT_TAG=$(gh release list --repo jonnyfiive/yardhouse --limit 5 --json tagName,isDraft --jq '[.[] | select(.isDraft==true)] | .[0].tagName // empty')
  if [ -n "$DRAFT_TAG" ]; then
    echo "Found draft with tag: $DRAFT_TAG"
    gh release edit "$DRAFT_TAG" --repo jonnyfiive/yardhouse --draft=false --tag "v$NEW" --title "$NEW"
    echo "Published as v$NEW"
  else
    echo "WARNING: No draft release found. You may need to publish manually at:"
    echo "  https://github.com/jonnyfiive/yardhouse/releases"
  fi
fi

echo ""
echo "=== Released Yardhouse v$NEW ==="
echo "  DMG: release/Yardhouse-$NEW-arm64.dmg"
echo "  GitHub: https://github.com/jonnyfiive/yardhouse/releases/tag/v$NEW"
echo ""
echo "  All machines will auto-update on next launch."
echo ""
