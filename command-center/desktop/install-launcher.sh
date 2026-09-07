#!/usr/bin/env bash
# Installs the "The Digital Side — Command Center" desktop launcher into the standard
# per-user location so it shows up in the Chromebook / Linux app launcher and can be pinned
# to the shelf. Safe to re-run; it just rewrites the entry with paths for this checkout.
#
# Run once:  bash command-center/desktop/install-launcher.sh
# (You do NOT need to run this yourself if the assistant already ran it for you.)

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ICON="$APP_DIR/src-tauri/icons/icon.png"
LAUNCH="$SCRIPT_DIR/launch.sh"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DEST="$APPS_DIR/the-digital-side-command-center.desktop"

chmod +x "$LAUNCH"
mkdir -p "$APPS_DIR"

cat > "$DEST" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=The Digital Side — Command Center
GenericName=Business Command Center
Comment=Local-first command center for The Digital Side
Exec=$LAUNCH
Path=$APP_DIR
Icon=$ICON
Terminal=false
Categories=Office;ProjectManagement;
StartupNotify=false
EOF

chmod +x "$DEST" 2>/dev/null || true

# Refresh the desktop database if the tool is present (not required on ChromeOS/Crostini).
command -v update-desktop-database > /dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true

echo "Installed: $DEST"
echo "Exec  -> $LAUNCH"
echo "Icon  -> $ICON"
echo
echo "Open it from the Chromebook launcher: search \"Command Center\" (or \"The Digital Side\")."
echo "Right-click the result to pin it to the shelf."
