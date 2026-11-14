#!/usr/bin/env bash
# Round 2 build check: fixtures, r2 output, untouched r1 and vendor.
set -euo pipefail
cd "$(dirname "$0")"
python3 bake_albums.py >/dev/null
python3 build.py >/dev/null
r2=out/android-home-r2.html
test -f "$r2" || { echo "FAIL: no $r2"; exit 1; }
for s in 'data-review-focus="home-r2"' 'window.PHONE_ALBUMS=' 'id="homeAlbumDay"'; do
  grep -qF "$s" "$r2" || { echo "FAIL: $r2 lacks $s"; exit 1; }
done
(cd out && sha256sum -c --quiet android-home-review.html.sha256) || { echo "FAIL: r1 html changed"; exit 1; }
(cd vendor && sha256sum -c --quiet SHA256SUMS) || { echo "FAIL: vendor changed"; exit 1; }
python3 - <<'PY'
import json
a = json.load(open('/mnt/data/musix-snapshots/2026-11-13-android-rebuild/albums.json'))
ray = next(v for v in a.values() if v['album'] == 'Ray Of Light')
assert len(ray['tracks']) == 13, len(ray['tracks'])
assert any(t['t'] == 'Frozen' and t['d'] == 373 for t in ray['tracks'])
assert len(a) == 4
PY
echo "PASS: r2 build"
