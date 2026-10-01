#!/usr/bin/env bash
# Publishes a Windows release built by pack.ps1: Velopack's files go to <downloads>/windows/
# (the app's update feed, served at /download/windows/), and manifest.json gets the
# "windows" entry that GET /app/windows/latest reads. The other platforms' entries stay.
#   tools/windows/publish.sh RELEASES_DIR [DOWNLOADS_DIR] --yes
# DOWNLOADS_DIR defaults to prod's; writing there is a prod step, hence --yes.
set -euo pipefail
YES=0; ARGS=()
for a in "$@"; do if [ "$a" = --yes ]; then YES=1; else ARGS+=("$a"); fi; done
SRC=${ARGS[0]:?RELEASES_DIR}
DEST=${ARGS[1]:-/mnt/data/musix-v2-prod/media/downloads}
[ "$YES" = 1 ] || { echo "writes to $DEST — add --yes"; exit 2; }
[ -f "$SRC/releases.win.json" ] || { echo "no releases.win.json in $SRC"; exit 1; }
mkdir -p "$DEST/windows"
# packages first, the feed index last: a client never sees an index naming a missing file
find "$SRC" -maxdepth 1 -type f ! -name releases.win.json ! -name RELEASES -exec cp -p {} "$DEST/windows/" \;
cp "$SRC/releases.win.json" "$DEST/windows/releases.win.json.tmp" && mv "$DEST/windows/releases.win.json.tmp" "$DEST/windows/releases.win.json"
[ -f "$SRC/RELEASES" ] && cp "$SRC/RELEASES" "$DEST/windows/RELEASES"
python3 - "$DEST" <<'PY'
import hashlib, json, pathlib, sys
dest = pathlib.Path(sys.argv[1])
feed = json.loads((dest / "windows" / "releases.win.json").read_text(encoding="utf-8-sig"))
full = [a for a in feed["Assets"] if a["Type"] == "Full"]
ver = lambda a: tuple(int(x) for x in a["Version"].split("-")[0].split("."))
last = max(full, key=ver)
major, minor, patch = (ver(last) + (0, 0, 0))[:3]
setup = dest / "windows" / "MusiX-win-Setup.exe"
manifest_path = dest / "manifest.json"
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
manifest["windows"] = {
    "versionCode": major * 10000 + minor * 100 + patch,
    "versionName": last["Version"],
    "url": "/download/windows/MusiX-win-Setup.exe",
    "sha256": hashlib.sha256(setup.read_bytes()).hexdigest(),
    "notes": last.get("NotesMarkdown") or "",
}
tmp = manifest_path.with_suffix(".tmp")
tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
tmp.replace(manifest_path)
print("windows", manifest["windows"]["versionName"], "published to", dest)
PY
