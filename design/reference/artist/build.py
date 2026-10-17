"""Assemble the artist mock: python build.py OUT_DIR (needs OUT_DIR/data.json + img/ from bake.py, bake2.py)."""
import base64, json, pathlib, re, sys
here = pathlib.Path(__file__).parent; out = pathlib.Path(sys.argv[1])
icons = {}
for line in pathlib.Path("/mnt/data/v2-branch/web/src/ui/icons.tsx").read_text().splitlines():
    m = re.match(r"\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$", line)
    if m: icons[m[1]] = {"d": json.loads(m[2]), "w": float(m[3]), "fill": json.loads(m[4])}
data = json.loads((out / "data.json").read_text())
flags = {}
for a in data["artists"]:
    cc = (a.get("cc") or "").lower()
    p = pathlib.Path(f"/mnt/data/v2-branch/web/node_modules/flag-icons/flags/4x3/{cc}.svg")
    if cc and p.exists(): flags[cc] = "data:image/svg+xml;base64," + base64.b64encode(p.read_bytes()).decode()
fonts = "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Noto+Sans:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
page = "\n".join([
    '<meta charset="utf-8">', "<title>Артист MusiX</title>", '<meta name="claude:viewport-fit-sides" content="cover">',
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    f'<link rel="stylesheet" href="{fonts}">',
    "<style>", (here / "frame.css").read_text(), (here / "artist.css").read_text(), "</style>",
    (here / "markup.html").read_text(),
    "<script>", f"window.ICONS={json.dumps(icons, ensure_ascii=False)};", f"window.DATA={json.dumps(data, ensure_ascii=False)};", f"window.FLAGS={json.dumps(flags)};",
    "const FLAGS=window.FLAGS;", (here / "edit_block.js").read_text(), (here / "logic.js").read_text(), "</script>",
])
(out / "musix-artist.html").write_text(page)
print(f"{out}/musix-artist.html {len(page)//1024} KB, {len(icons)} icons, flags {sorted(flags)}")
