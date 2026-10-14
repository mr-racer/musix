"""Assemble the settings mock: python build.py OUT_DIR. Needs img/ + covers.json from
`python bake.py STAND.json .` (the stand's read-only copy of the owner's library) and img/library.jpg
(a 1628x1041 crop of the built library at 1728x1117, bar excluded) and favs.json + img/f*.jpg
(the listener's top songs: cover, backdrop, palette; read-only from prod). img/ is copied next to the page."""
import json, pathlib, re, shutil, sys
here = pathlib.Path(__file__).parent; out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
icons = {}
for line in (pathlib.Path("/mnt/data/v2-branch/web/src/ui/icons.tsx")).read_text().splitlines():
    m = re.match(r"\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$", line)
    if m: icons[m[1]] = {"d": json.loads(m[2]), "w": float(m[3]), "fill": json.loads(m[4])}
fonts = "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Noto+Sans:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap"
page = "\n".join([
    "<title>Настройки MusiX</title>",
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    f'<link rel="stylesheet" href="{fonts}">',
    "<style>", (here / "styles.css").read_text(), "</style>",
    (here / "markup.html").read_text(),
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>',
    "<script>", f"window.ICONS={json.dumps(icons, ensure_ascii=False)};", f"window.COVERS={(here / 'covers.json').read_text()};", f"window.FAVS={(here / 'favs.json').read_text()};",
    (here / "logic.js").read_text().replace("/*LIB*/", (here / "lib.js").read_text()), "</script>",
])
(out / "musix-settings.html").write_text(page)
shutil.copytree(here / "img", out / "img", dirs_exist_ok=True)
print(f"{out}/musix-settings.html {len(page)//1024} KB, {len(icons)} icons")
