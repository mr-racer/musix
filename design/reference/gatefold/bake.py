"""Bake the gatefold mock's data from a real account (album art is not committed).

usage: python bake.py ALBUMS.json MEDIA_ROOT OUT.json
  ALBUMS.json  the export of q.sql (albums with tracks, plays, producers, labels, the artist's other albums)
  MEDIA_ROOT   the media dir with i/<xx>/<image id>/{1024,256,bg}.webp
Out: every album with its cover as a 720 px JPEG data URI (the sleeve), the server's backdrop
(`bg`, already blurred and tamed) as a data URI, small covers for the artist's other albums."""
import base64, io, json, pathlib, re, sys
from PIL import Image

albums = json.loads(pathlib.Path(sys.argv[1]).read_text())
root, out = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])

def uri(cid, variant, px, q=80):
    if not cid: return None
    p = root / "i" / cid[:2] / cid / f"{variant}.webp"
    if not p.exists(): return None
    im = Image.open(p).convert("RGB")
    if px: im = im.resize((px, round(px * im.height / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def deep(cid):
    """The back's paper: the server backdrop (already tamed) blurred until no shape of the
    cover is left, only its colour field. A proposed server variant `bg-deep`."""
    p = root / "i" / cid[:2] / cid / "bg.webp"
    if not p.exists(): return None
    from PIL import ImageFilter
    im = Image.open(p).convert("RGB").resize((256, 256), Image.LANCZOS)
    im = im.filter(ImageFilter.GaussianBlur(26))
    b = io.BytesIO(); im.save(b, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def clean_producers(a):
    me = (a.get("artist") or {}).get("name", "")
    parts = set(me.lower().split())
    got = []
    for p in a.get("producers") or []:
        n = p["n"].strip()
        if n.lower() == me.lower() or n.lower() in parts or "youtuber" in n.lower(): continue   # "West", "Kanye", noise from the web
        if p["c"] < 2 and len(got) >= 2: continue
        got.append({"n": n, "c": p["c"]})
    return got[:4]

def clean_label(a):
    ls = a.get("labels") or []
    if not ls: return None
    first = re.split(r",\s*|\s*&\s*", ls[0]["n"])
    return first[0].strip()

small = {}
res = []
for a in albums:
    for m in a.get("more") or []:
        if m["cover"] and m["cover"] not in small: small[m["cover"]] = uri(m["cover"], "256", 120, 74)
    pal = a.get("palette") or {}
    res.append({
        "id": a["id"], "title": a["title"], "year": a["year"], "artist": a["artist"],
        "acc": (pal.get("accent") or {}).get("dark"), "vib": pal.get("vibrant"), "dom": pal.get("dominant"), "mut": pal.get("muted"),
        "cover": uri(a["cover"], "1024", 720, 82), "bg": deep(a["cover"]) if a["cover"] else None,
        "lossless": all((t.get("codec") or "") in ("flac", "alac") for t in a["tracks"]),
        "tracks": [{"id": t["id"], "t": t["title"], "no": t["no"], "disc": t["disc"], "ms": t["ms"], "genre": t["genre"], "plays": t["plays"], "last": t["last"],
                    "feat": [x["name"] for x in (t["artists"] or [])[1:]]} for t in a["tracks"]],
        "producers": clean_producers(a), "label": clean_label(a),
        "more": [{"id": m["id"], "title": m["title"], "year": m["year"], "c": m["cover"]} for m in a.get("more") or []],
    })
order = ["My Beautiful", "Graduation", "808s", "AM", "Ray Of", "Curtain", "Starboy", "Watch", "Late Reg"]
res.sort(key=lambda a: next(i for i, o in enumerate(order) if a["title"].startswith(o)))
out.write_text(json.dumps({"albums": res, "small": small}, ensure_ascii=False))
print(out, out.stat().st_size // 1024, "KB;", [(a["title"][:14], a["producers"][:3], a["label"]) for a in res])
