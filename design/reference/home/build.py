"""Assemble the home mock into one HTML page.

usage: python build.py DATA.json OUT.html     (DATA.json comes from bake.py; it holds album art
and is not committed). The icons are read from the app's own set, web/src/ui/icons.tsx."""
import json, pathlib, re, sys

here = pathlib.Path(__file__).parent
data = pathlib.Path(sys.argv[1]).read_text()
icons = {}
for line in (here / "../../../web/src/ui/icons.tsx").read_text().splitlines():
    m = re.match(r"\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$", line)
    if m:
        icons[m[1]] = {"d": json.loads(m[2]), "w": float(m[3]), "fill": json.loads(m[4])}
fonts = "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Noto+Sans:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400&display=swap"
page = "\n".join([
    "<title>Главная MusiX</title>",
    f'<link rel="stylesheet" href="{fonts}">',
    "<style>", (here / "styles.css").read_text(), (here / "variants.css").read_text(), "</style>",
    (here / "markup.html").read_text(),
    "<script>", f"window.ICONS={json.dumps(icons, ensure_ascii=False)};", f"window.DATA={data};", (here / "logic.js").read_text(), "</script>",
])
pathlib.Path(sys.argv[2]).write_text(page)
print(f"{sys.argv[2]}: {len(page) // 1024} KB, {len(icons)} icons")
