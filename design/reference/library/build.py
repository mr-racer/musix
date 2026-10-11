"""Assemble the library mock into one HTML page.

usage: python build.py DATA.json OUT.html [STATS.json]     (DATA.json comes from bake.py; it holds album art
and is not committed). The icons are read from the app's own set, web/src/ui/icons.tsx."""
import json, pathlib, re, sys

here = pathlib.Path(__file__).parent
icons_src = here / "../../../web/src/ui/icons.tsx"
data = pathlib.Path(sys.argv[1]).read_text()
icons = {}
for line in icons_src.read_text().splitlines():
    m = re.match(r"\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$", line)
    if m:
        icons[m[1]] = {"d": json.loads(m[2]), "w": float(m[3]), "fill": json.loads(m[4])}
fonts = "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Noto+Sans:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400;600&display=swap"
page = "\n".join([
    "<title>Библиотека MusiX</title>",
    f'<link rel="stylesheet" href="{fonts}">',
    "<style>", (here / "styles.css").read_text(), (here / "stats.css").read_text(), "</style>",
    (here / "markup.html").read_text(),
    "<script>", f"window.ICONS={json.dumps(icons, ensure_ascii=False)};", f"window.DATA={data};",
    f"window.STATS={pathlib.Path(sys.argv[3]).read_text()};window.START_TAB='stats';" if len(sys.argv) > 3 else "",
    (here / "logic.js").read_text(), (here / "stats.js").read_text() if len(sys.argv) > 3 else "", "</script>",
])
pathlib.Path(sys.argv[2]).write_text(page)
print(f"{sys.argv[2]}: {len(page) // 1024} KB, {len(icons)} icons")
