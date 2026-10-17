"""Add to OUT/data.json: Apple Music images (variant В, fetched 2026-10-14 from music.apple.com),
dropped when the picture is empty (Kanye's profile is a black square), and collaborator photos."""
import json, sqlite3, sys, pathlib
from PIL import Image, ImageStat
OUT = pathlib.Path(sys.argv[1]); DL = pathlib.Path(sys.argv[2]); V1 = pathlib.Path("/mnt/data/lyrics-search/frontend")
d = json.load(open(OUT / "data.json"))
db = sqlite3.connect("file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1", uri=True)
def empty(im):
    st = ImageStat.Stat(im.convert("L").resize((64, 64)))
    return st.stddev[0] < 6
for a in d["artists"]:
    s = a["slug"]; am = {}
    meta = json.load(open(DL / f"{s}.am.json")) if (DL / f"{s}.am.json").exists() else {}
    for kind, size in (("wide", (2400, 1200)), ("sq", (1400, 1400))):
        p = DL / f"am2-{s}-{kind}.jpg"
        if p.exists():
            im = Image.open(p).convert("RGB")
            if empty(im):
                print(s, kind, "empty → skipped"); continue
            im.resize(size, Image.LANCZOS).save(OUT / "img" / f"{s}-am-{kind}.jpg", quality=80)
            am[kind] = f"{s}-am-{kind}"
    p = DL / f"am2-{s}-logo.png"
    if p.exists():
        im = Image.open(p).convert("RGBA"); im.thumbnail((1100, 400)); im.save(OUT / "img" / f"{s}-am-logo.png", optimize=True); am["logo"] = f"{s}-am-logo"
    for k in ("wideArtwork", "artwork"):
        if meta.get(k, {}).get("bg"):
            am["bg"] = "#" + meta[k]["bg"]; break
    a["apple"] = am
    for w in a["with"]:
        r = db.execute("select slug, thumb_path from artists where name=? and thumb_path is not null and thumb_path != '' limit 1", (w["name"],)).fetchone()
        if r and (V1 / r[1].lstrip("/")).exists():
            im = Image.open(V1 / r[1].lstrip("/")).convert("RGB"); im.thumbnail((96, 96)); im.save(OUT / "img" / f"w-{r[0].replace('$', 's')}.jpg", quality=82); w["img"] = f"w-{r[0].replace('$', 's')}"
    print(s, am)
json.dump(d, open(OUT / "data.json", "w"), ensure_ascii=False, indent=1)
