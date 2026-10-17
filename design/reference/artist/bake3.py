"""Add each album's colour (the most saturated common colour of its cover) to OUT/data.json:
the rings of the «Ты и артист» record are drawn in their albums' colours."""
import json, sys, pathlib
from PIL import Image
OUT = pathlib.Path(sys.argv[1]); d = json.load(open(OUT / "data.json"))
def vibrant(im):
    q = im.convert("RGB").resize((64, 64)).quantize(12, method=Image.Quantize.MEDIANCUT).convert("RGB")
    best, score = (200, 200, 210), -1.0
    for n, (r, g, b) in q.getcolors(4096) or []:
        mx, mn = max(r, g, b), min(r, g, b); sat = (mx - mn) / (mx or 1); lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        s = sat * (0.25 + min(lum, 0.7)) * (n ** 0.35)
        if 0.18 < lum < 0.9 and s > score: best, score = (r, g, b), s
    if score < 0.08 * 64 ** .35: best = (215, 215, 222)  # a grey cover gets a light neutral, not mud
    return "#%02x%02x%02x" % best
for a in d["artists"]:
    for al in a["albums"]:
        if al.get("cover"): al["col"] = vibrant(Image.open(OUT / "img" / f"{al['cover']}.jpg"))
    print(a["slug"], [al.get("col") for al in a["albums"]])
json.dump(d, open(OUT / "data.json", "w"), ensure_ascii=False, indent=1)
