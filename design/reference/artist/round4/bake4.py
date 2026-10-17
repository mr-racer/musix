"""Round 4: the story of the listener and the artist — python bake4.py OUT_DIR (after bake.py..bake3.py).
Adds per artist: story.first (the first song heard, its date and cover), story.weeks (plays per week
over the snapshot's history), heardAll (songs heard at least once) and story.levels (the day each level was reached, replaying the plays
with the same rule as level() in logic.js)."""
import json, sqlite3, sys, pathlib, datetime as dt
from collections import defaultdict
from PIL import Image

OUT = pathlib.Path(sys.argv[1]); V1 = pathlib.Path("/mnt/data/lyrics-search/frontend")
db = sqlite3.connect("file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1", uri=True)
C = "acct_c2b5b12d55d341feb0940929e5a12c0d"
AT = [0, 10, 50, 150, 300]
data = json.loads((OUT / "data.json").read_text())
lo, hi = db.execute("select min(played_at), max(played_at) from playback_events where collection_name=?", (C,)).fetchone()
d0 = dt.date.fromisoformat(lo[:10]); d0 -= dt.timedelta(days=d0.weekday())   # the Monday of the first week
nweeks = (dt.date.fromisoformat(hi[:10]) - d0).days // 7 + 1


def cover(path):
    if not path: return None
    src = V1 / path.lstrip("/")
    if not src.exists(): return None
    name = "c-" + src.stem; dst = OUT / "img" / f"{name}.jpg"
    if not dst.exists(): Image.open(src).convert("RGB").resize((320, 320), Image.LANCZOS).save(dst, quality=84)
    return name


for a in data["artists"]:
    ev = db.execute("""select pe.played_at, pe.skipped_early, t.track_id, t.title, t.album, t.cover_art_path from playback_events pe
      join track_metadata t on t.track_id=pe.track_id and t.collection_name=pe.collection_name
      where pe.collection_name=? and t.primary_artist_slug=? order by pe.played_at""", (C, a["slug"])).fetchall()
    sizes = {al["title"]: al["n"] for al in a["albums"]}
    first = next((e for e in ev if not e[1]), ev[0])
    weeks = [0] * nweeks; heard = defaultdict(set); plays = 0; k = 0; levels = []
    for at, skipped, tid, title, album, _ in ev:
        if skipped: continue
        weeks[(dt.date.fromisoformat(at[:10]) - d0).days // 7] += 1
        plays += 1
        if album in sizes: heard[album].add(tid)
        done = sum(1 for t, n in sizes.items() if len(heard[t]) / n >= .5); cov = done / max(1, len(sizes))
        kk = 0
        for j, need in enumerate(AT):
            if plays >= need and (j < 3 or cov >= (.5 if j == 3 else 1)): kk = j
        while k < kk:
            k += 1; levels.append({"k": k, "date": at[:10]})
    a["story"] = {"first": {"title": first[3], "album": first[4], "date": first[0][:10], "cover": cover(first[5])},
                  "weeks": weeks, "w0": d0.isoformat(), "end": hi[:10], "levels": levels}
    a["heardAll"] = len({e[2] for e in ev if not e[1]})
    print(a["slug"], a["story"]["first"]["title"], a["story"]["first"]["date"], weeks, levels)
(OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
