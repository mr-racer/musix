"""Bake the settings mock's covers from the stand's copy of the owner's library (read-only)."""
import io, json, os, sys
from PIL import Image
D = json.load(open(sys.argv[1])); OUT = sys.argv[2]
ch = [c for pg in D["sync"] for c in pg["changes"]]
by = {}
for c in ch: by.setdefault(c["entity"], {})[c["id"]] = c["data"]
want = ["My Beautiful Dark Twisted Fantasy", "Graduation", "Watch the Throne", "Starboy", "After Hours", "Royal Blood",
        "The Fame Monster", "Overexposed", "Minutes to Midnight", "Magna Carta Holy Grail", "808s & Heartbreak", "Unapologetic",
        "Random Access Memories", "Currents", "AM", "Discovery", "Blonde", "To Pimp a Butterfly", "Yeezus", "The Life of Pablo"]
out = []
for t in want:
    a = next((a for a in by["album"].values() if a["title"] == t and a.get("coverImageId")), None)
    if not a: print("miss", t); continue
    i = a["coverImageId"]; im = by["image"].get(i, {})
    src = f"/mnt/data/musix-v2-prod/media/i/{i[:2]}/{i}/"
    name = f"c{len(out)}"
    Image.open(src + "512.webp").convert("RGB").resize((320, 320), Image.LANCZOS).save(f"{OUT}/img/{name}.jpg", quality=84)
    if len(out) == 0 and os.path.exists(src + "bg.webp"):
        Image.open(src + "bg.webp").convert("RGB").save(f"{OUT}/img/{name}-bg.jpg", quality=86)
        Image.open(src + "1024.webp").convert("RGB").resize((560, 560), Image.LANCZOS).save(f"{OUT}/img/{name}-l.jpg", quality=86)
    art = by["artist"].get(a.get("albumArtistId"), {}).get("name", "")
    out.append({"img": name, "title": t, "artist": art, "year": a.get("year"), "pal": im.get("palette")})
json.dump(out, open(f"{OUT}/covers.json", "w"), ensure_ascii=False, indent=0)
print(len(out), "covers")
