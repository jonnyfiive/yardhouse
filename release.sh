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
echo "  Building DMG + ZIP..."
echo ""

# Build and publish to GitHub Releases
GH_TOKEN=$(gh auth token 2>/dev/null || echo "")

if [ -z "$GH_TOKEN" ]; then
  echo "ERROR: GitHub CLI not authenticated."
  echo "Run: gh auth login"
  echo ""
  echo "Or set GH_TOKEN manually:"
  echo "  export GH_TOKEN=your_github_token"
  exit 1
fi

export GH_TOKEN

# Build + publish
npm run release

echo ""
echo "=== Released Yardhouse v$NEW ==="
echo "  DMG: release/Yardhouse-$NEW-arm64.dmg"
echo "  GitHub: https://github.com/justnationllc/yardhouse/releases/tag/v$NEW"
echo ""
echo "  All machines will auto-update on next launch."
echo ""
