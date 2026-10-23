"""Assemble the assistant mock: python build.py OUT_DIR (needs OUT_DIR/data.json + img/ from bake.py)."""
import json, pathlib, re, sys
here = pathlib.Path(__file__).parent; out = pathlib.Path(sys.argv[1])
icons = {}
for line in pathlib.Path("/mnt/data/v2-branch/web/src/ui/icons.tsx").read_text().splitlines():
    m = re.match(r"\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$", line)
    if m: icons[m[1]] = {"d": json.loads(m[2]), "w": float(m[3]), "fill": json.loads(m[4])}
data = json.loads((out / "data.json").read_text())
fonts = "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Noto+Sans:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
js = lambda n: (here / n).read_text()
page = "\n".join([
    '<meta charset="utf-8">', "<title>Ассистент MusiX</title>", '<meta name="claude:viewport-fit-sides" content="cover">',
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    f'<link rel="stylesheet" href="{fonts}">',
    "<style>", js("frame.css"), js("assistant.css"), "</style>",
    js("markup.html"),
    "<script>", f"window.ICONS={json.dumps(icons, ensure_ascii=False)};", f"window.DATA={json.dumps(data, ensure_ascii=False)};",
    js("orb.js"), js("edit_block.js"), js("logic.js"), js("flow.js"), js("boot.js"), "</script>",
])
(out / "musix-assistant.html").write_text(page)
print(f"{out}/musix-assistant.html {len(page)//1024} KB, {len(icons)} icons")
