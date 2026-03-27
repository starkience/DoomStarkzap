#!/bin/bash
# Downloads pre-built Doom WASM artifacts and shareware WAD
set -e

DEST="$(dirname "$0")/../client/public"
BASE_URL="https://doom.moparisthe.best"

mkdir -p "$DEST"

echo "Downloading WASM artifacts from $BASE_URL..."
curl -L -o "$DEST/websockets-doom.js"       "$BASE_URL/websockets-doom.js"
curl -L -o "$DEST/websockets-doom.wasm"     "$BASE_URL/websockets-doom.wasm"
curl -L -o "$DEST/websockets-doom.wasm.map" "$BASE_URL/websockets-doom.wasm.map"
curl -L -o "$DEST/default.cfg"              "$BASE_URL/default.cfg"
curl -L -o "$DEST/doom1.wad"                "$BASE_URL/doom1.wad"

echo ""
echo "Downloaded files:"
ls -lh "$DEST"/websockets-doom.* "$DEST"/default.cfg "$DEST"/doom1.wad
echo ""
echo "Done! WASM artifacts are in client/public/"
