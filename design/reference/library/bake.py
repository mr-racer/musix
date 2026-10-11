"""Bake the library mock's data from a real account (album art is not committed).

usage: python bake.py LIBRARY.json MEDIA_ROOT OUT_DIR [FLAGS_DIR]
  FLAGS_DIR     optional: <cc>.svg country flags (flag-icons 4x3, MIT), inlined for the countries present
  LIBRARY.json  the export of q.sql
  MEDIA_ROOT    the media dir with i/<xx>/<image id>/{1024,512,256,bg}.webp
Out: OUT_DIR/data.json and OUT_DIR/img/{a,r}<n>.jpg: covers and artist photos in atlases of
4 × 4 tiles of 320 px (from the server's 512 variant), so the page loads a dozen pictures
instead of a thousand inline ones; a cell is [sheet, index]. Playlist covers and the
candidates for «Пластинка дня» (played 8+ times, untouched the longest) stay inline."""
import base64, io, json, pathlib, sys
from PIL import Image

src = json.loads(pathlib.Path(sys.argv[1]).read_text())
root, out = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
(out / "img").mkdir(parents=True, exist_ok=True)
T, G = 320, 4   # 4 × 4 per sheet: smaller decodes, less for the browser to throw away and redo while scrolling

def load(cid, variants=("512", "1024", "256")):
    for v in variants:
        p = root / "i" / cid[:2] / cid / f"{v}.webp"
        if p.exists(): return Image.open(p).convert("RGB")
    return None

def square(im, top=0.5):
    w, h = im.size
    if w > h: x = (w - h) // 2; return im.crop((x, 0, x + h, h))
    if h > w: y = int((h - w) * top); return im.crop((0, y, w, y + w))
    return im

def atlas(items, prefix, top=0.5):
    cells, sheet, n = {}, None, -1
    for j, (key, cid) in enumerate(items):
        if j % (G * G) == 0:
            if sheet: sheet.save(out / "img" / f"{prefix}{n}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
            sheet, n = Image.new("RGB", (G * T, G * T), (27, 27, 32)), n + 1
        im = load(cid)
        if im is None: continue
        k = j % (G * G)
        sheet.paste(square(im, top).resize((T, T), Image.LANCZOS), ((k % G) * T, (k // G) * T))
        cells[key] = [n, k]
    if sheet: sheet.save(out / "img" / f"{prefix}{n}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    return cells, n + 1

def uri(cid, variant, px, q=80):
    im = load(cid, (variant,)) if cid else None
    if im is None: return None
    if px: im = square(im).resize((px, px), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def lq(cid):
    """the 96 px variant shrunk to 20 px: what shows while the real cover travels (a few hundred bytes)"""
    im = load(cid, ("96", "256")) if cid else None
    if im is None: return None
    b = io.BytesIO(); square(im).resize((20, 20), Image.LANCZOS).save(b, "JPEG", quality=60)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

GENRE = {"Rock": "Рок", "Pop": "Поп", "Hip-Hop": "Хип-хоп", "Hip Hop": "Хип-хоп", "Electronic": "Электроника",
         "Alternative": "Альтернатива", "R&B/Soul": "R&B и соул", "Soundtrack": "Саундтреки", "Nu-Metal": "Ню-метал"}
al = [a for a in src["albums"] if a["cover"]]
own = {a["artist"]["id"] for a in al if a.get("artist")}
ars = [a for a in src["artists"] if a["n"] >= 3 or a["id"] in own]
acells, an = atlas([(a["id"], a["cover"]) for a in al], "a")
rcells, rn = atlas([(a["id"], a["img"]) for a in ars if a["img"]], "r", top=0.22)
albums = [{"id": a["id"], "t": a["title"], "y": a["year"], "ar": a["artist"]["name"] if a.get("artist") else "", "arId": (a.get("artist") or {}).get("id"),
           "acc": a["acc"], "n": a["n"], "ms": a["ms"], "add": a["added"], "p": a["plays"], "last": a["last"],
           "g": GENRE.get(a["genre"] or "", "Другое"), "cl": a["cl"], "s": acells.get(a["id"]), "pal": a.get("pal"), "lq": lq(a["cover"])} for a in al]
artists = [{"id": a["id"], "name": a["name"], "n": a["n"], "al": a["albums"], "p": a["plays"], "last": a["last"], "s": rcells.get(a["id"]), "pal": a.get("pal"), "lq": lq(a["img"]),
            "cc": (lambda c: "GB" if c == "UK" else c if len(c) == 2 and c.isalpha() else None)((a.get("cc") or "").strip().upper())} for a in ars]
def tint(cid):
    """the playlist's colour: the mean of its first cover, for the card's plate"""
    im = load(cid, ("96", "256")) if cid else None
    return "rgb(%d,%d,%d)" % im.resize((1, 1), Image.BOX).getpixel((0, 0)) if im else "#2a2a32"
lists = [{"id": p["id"], "name": p["name"], "n": p["n"], "upd": p["updated_at"], "c": [uri(c, "512", 400, 78) for c in (p["covers"] or [])],
          "tint": tint((p["covers"] or [None])[0])} for p in src["playlists"]]
day = sorted([a for a in al if a["plays"] >= 8 and a["last"]], key=lambda a: a["last"])[:8]
picks = [{"id": a["id"], "big": uri(a["cover"], "1024", 720, 82) or uri(a["cover"], "512", 512, 82), "bg": uri(a["cover"], "bg", 0, 84)} for a in day]
clusters = [{"id": c["id"], "name": c["nameRu"], "size": c["size"]} for c in src["clusters"]]
flags = {}
if len(sys.argv) > 4:
    for cc in sorted({a["cc"] for a in artists if a["cc"]}):
        f = pathlib.Path(sys.argv[4]) / f"{cc.lower()}.svg"
        if f.exists(): flags[cc] = "data:image/svg+xml;base64," + base64.b64encode(f.read_bytes()).decode()
(out / "data.json").write_text(json.dumps({"flags": flags, "albums": albums, "artists": artists, "playlists": lists, "tracks": src["tracks"],
                                            "clusters": clusters, "picks": picks, "sheets": {"a": an, "r": rn, "g": G}}, ensure_ascii=False))
size = sum(f.stat().st_size for f in (out / "img").glob("*.jpg")) // 1024
print(f"data.json {(out / 'data.json').stat().st_size // 1024} KB; {an} album sheets + {rn} artist sheets = {size} KB")
