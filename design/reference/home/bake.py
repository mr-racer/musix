"""Bake the home mock's data from a real account (album art is not committed).

usage: python bake.py HOME.json DISCOVERIES.json COVERS_DIR OUT.json [ALBUMS.tsv PLAYLIST_COVERS.tsv PRESETS.json]
  HOME.json         GET /api/v2/home
  DISCOVERIES.json  GET /api/v2/assistant/discoveries?limit=6
  COVERS_DIR        <image id>.webp for every cover mentioned
  ALBUMS.tsv        why|id|title|artist|year|cover id|tracks|plays|last played   (why: fav, forgot, new)
  PLAYLIST_COVERS.tsv  name|cover ids of its tracks, comma-separated
  PRESETS.json      GET /api/v2/stream/presets

Out: the texts the home shows, every cover as a 240 px JPEG data URI with its palette, and
`bg`: the home's backdrop, the player's recipe (192 px, blur, saturation, tamed highlights)
applied to a mosaic of the taste anchors' covers."""
import base64, io, json, pathlib, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

home, disc = (json.loads(pathlib.Path(p).read_text()) for p in sys.argv[1:3])
covers, out_path = pathlib.Path(sys.argv[3]), sys.argv[4]
rows = lambda x: list(x.values()) if isinstance(x, dict) else list(x or [])
palettes = {i["id"]: i.get("palette") or {} for i in [*rows(home.get("images")), *rows(disc.get("images"))]}


def uri(im, q=74):
    b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def tame(im, knee=0.30, slope=0.18):
    a = np.asarray(im).astype(np.float32) / 255
    luma = a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722
    o = np.where(luma > knee, knee + (luma - knee) * slope, luma)
    return Image.fromarray((np.clip(a * (o / np.maximum(luma, 1e-4))[..., None], 0, 1) * 255).astype(np.uint8))


images, used = {}, set()
def cover(cid):
    if not cid or not (covers / f"{cid}.webp").exists(): return None
    if cid not in images:
        im = Image.open(covers / f"{cid}.webp").convert("RGB")
        s = min(im.size); im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2)).resize((240, 240), Image.LANCZOS)
        p = palettes.get(cid, {})
        images[cid] = {"uri": uri(im), "acc": (p.get("accent") or {}).get("dark"), "dom": p.get("dominant"), "vib": p.get("vibrant")}
    used.add(cid)
    return cid

def track(t):
    return {"id": t["id"], "title": t.get("titleDisplay") or t["title"], "artist": t["artistDisplay"], "album": t.get("album"), "year": t.get("year"), "genre": t.get("genre"), "ms": t.get("durationMs"), "c": cover(t.get("coverImageId"))}

by_id = {t["id"]: t for t in (disc.get("tracks") or {}).values()} if isinstance(disc.get("tracks"), dict) else {}
cards = []
for c in disc.get("cards", []):
    first = (c.get("items") or [{}])[0]
    t = by_id.get(c.get("track_id") or first.get("track_id") or "")
    cards.append({"kind": c["kind"], "headline": c["headline"], "subline": c.get("subline"), "badge": c.get("badge"), "fact": c.get("fact"), "prompt": c.get("prompt"),
                  "c": cover((t or {}).get("coverImageId") or first.get("cover_art_path"))})

data = {
    "phrase": (home.get("wave") or {}).get("phrase"),
    "counts": home["counts"], "pulse": home["pulse"],
    "vibes": [{"name": v.get("name") or "Вайб", "tracks": [track(t) for t in v["tracks"]]} for v in home["vibes"]],
    "anchors": [track(t) for t in home.get("anchors", [])],
    "recent": [track(t) for t in home.get("recent", [])],
    "added": [track(t) for t in home.get("recentlyAdded", [])],
    "playlists": [{"name": p["name"], "count": p.get("itemCount", 0)} for p in home.get("playlists", [])],
    "cards": cards,
}
# the backdrop: the anchors' covers as a mosaic, blurred and tamed like the player's
tiles = [Image.open(io.BytesIO(base64.b64decode(images[a["c"]]["uri"].split(",")[1]))) for a in data["anchors"] if a["c"]][:4]
if tiles:
    while len(tiles) < 4: tiles.append(tiles[len(tiles) % len(tiles)])
    m = Image.new("RGB", (192, 192))
    for n, t in enumerate(tiles): m.paste(t.resize((96, 96), Image.LANCZOS), ((n % 2) * 96, (n // 2) * 96))
    soft = ImageEnhance.Color(m.filter(ImageFilter.GaussianBlur(14))).enhance(1.4)
    data["bg"] = uri(tame(soft), 70)
    data["mosaic"] = uri(Image.merge("RGB", m.split()).resize((192, 192)), 80)
# round two (2026-10-06): albums to offer, playlists with a cover made of their own tracks, the wave's presets
extra = sys.argv[5:8]
if len(extra) == 3:
    WHY = {"fav": "любимый", "forgot": "давно не включал", "new": "ещё не слушал"}
    groups = {"fav": [], "forgot": [], "new": []}
    for line in pathlib.Path(extra[0]).read_text().splitlines():
        why, aid, title, artist, year, cid, n, plays, last = line.split("|")
        if cover(cid):
            groups[why].append({"title": title, "artist": artist, "year": year, "n": int(n), "plays": int(plays), "why": WHY[why], "c": cid})
    albums = []          # one of each kind in turn: the shelf mixes the forgotten, the unheard and the loved
    for i in range(7):
        for k in ("forgot", "new", "fav"):
            if i < len(groups[k]): albums.append(groups[k][i])
    data["albums"] = albums[:14]
    covers_of = {}
    for line in pathlib.Path(extra[1]).read_text().splitlines():
        name, ids = line.split("|", 1)
        covers_of[name] = [c for c in (cover(i) for i in ids.split(",")[:4]) if c]
    data["playlists"] = [{"name": p["name"], "count": p.get("itemCount", 0), "covers": covers_of.get(p["name"], [])} for p in home.get("playlists", [])]
    data["presets"] = [{"row": p["row"], "id": p["id"], "label": p["labelRu"]} for p in json.loads(pathlib.Path(extra[2]).read_text())]
data["images"] = {k: v for k, v in images.items() if k in used}
pathlib.Path(out_path).write_text(json.dumps(data, ensure_ascii=False))
print(f"{out_path}: {len(data['images'])} covers, {len(data['recent'])} recent, {len(cards)} cards, {pathlib.Path(out_path).stat().st_size // 1024} KB")
