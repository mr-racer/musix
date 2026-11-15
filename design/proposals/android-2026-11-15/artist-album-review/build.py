"""Build the offline phone artist + album review «Конверт». Data, pictures and outputs stay outside Git.

usage: python3 build.py [--data DIR] [--out DIR]
  DIR/data.json and DIR/img/* are what bake.py wrote (the frozen v1 snapshot and the approved artist mock's
  export). The result is one self-contained HTML: fonts, icons, data and pictures inlined.
"""
from pathlib import Path
import argparse
import base64
import html
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SNAP = Path('/mnt/data/musix-snapshots/2026-11-15-android-artist-album-review')
parser = argparse.ArgumentParser()
parser.add_argument('--data', type=Path, default=SNAP)
parser.add_argument('--out', type=Path, default=SNAP)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
CYR = 'U+0400-052F,U+2DE0-2DFF,U+A640-A69F'


def fonts():
    rules = []
    faces = [('Geist', 'geist', [(400, 'normal'), (500, 'normal'), (600, 'normal'), (700, 'normal')]),
             ('Noto Sans', 'noto-sans', [(400, 'normal'), (400, 'italic'), (600, 'normal')]),
             ('JetBrains Mono', 'jetbrains-mono', [(400, 'normal'), (500, 'normal')])]
    for family, stem, variants in faces:
        for weight, style in variants:
            for subset, cps in (('latin', LATIN), ('cyrillic', CYR)):
                path = ROOT / f'web/node_modules/@fontsource/{stem}/files/{stem}-{subset}-{weight}-{style}.woff2'
                if not path.is_file():
                    continue
                data = base64.b64encode(path.read_bytes()).decode()
                rules.append(f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};font-display:swap;"
                             f"src:url(data:font/woff2;base64,{data}) format('woff2');unicode-range:{cps}}}")
    return '\n'.join(rules)


def icons():
    defs = {}
    for line in (ROOT / 'web/src/ui/icons.tsx').read_text().splitlines():
        m = re.match(r'\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$', line)
        if m:
            defs[m[1]] = dict(d=json.loads(m[2]), w=float(m[3]), fill=json.loads(m[4]))
    return defs


def images(folder: Path):
    kinds = {'.jpg': 'jpeg', '.png': 'png', '.webp': 'webp'}
    return {p.stem: f'data:image/{kinds[p.suffix]};base64,' + base64.b64encode(p.read_bytes()).decode()
            for p in sorted(folder.iterdir()) if p.suffix in kinds}


def plural(n, one, few, many):
    a, b = abs(n) % 100, abs(n) % 10
    return many if 10 < a < 20 else few if 1 < b < 5 else one if b == 1 else many


def hint(a):
    """What this artist shows on the screen, for the panel's list."""
    n = len(a['albums'])
    bits = [f'{n} {plural(n, "альбом", "альбома", "альбомов")}']
    g = a.get('grammy')
    if a.get('logo'):
        bits.append('логотип')
    if not g:
        bits.append('без «Грэмми»')
    elif not g.get('wins'):
        bits.append('только номинации')
    page = a.get('page') or '#000000'
    r, gg, b = (int(page[i:i + 2], 16) for i in (1, 3, 5))
    if (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255 > 0.55:
        bits.append('светлое фото')
    if a.get('dead'):
        bits.append('годы жизни')
    if len(a['name']) > 18:
        bits.append('длинное имя')
    return ' · '.join(bits)


data = json.loads((args.data / 'data.json').read_text())
data['img'] = images(args.data / 'img')
options = ''.join(f'<option value="{a["slug"]}"{" selected" if a["slug"] == "arctic-monkeys" else ""}>'
                  f'{html.escape(a["name"])} · {html.escape(hint(a))}</option>' for a in data['artists'])
css = fonts() + '\n' + (HERE / 'kit.css').read_text() + '\n' + (HERE / 'screens.css').read_text()
script = '(()=>{\n"use strict";\nconst DATA=' + json.dumps(data, ensure_ascii=False) + ';\nconst ICONS=' + json.dumps(icons()) + ';\n'
for name in ('kit.js', 'screens.js'):
    script += f'\n/* ---- {name} ---- */\n' + (HERE / name).read_text()
script += '\n})();'
page = (HERE / 'review.html').read_text().replace('/* INLINE_CSS */', css)
page = page.replace('<!-- PHONE -->', (HERE / 'phone.html').read_text()).replace('<!-- ARTISTS -->', options)
page = page.replace('/* INLINE_JS */', script.replace('</script', '<\\/script'))
out = args.out / 'android-artist-album-review.html'
out.write_text(page)
print(f'Built {out} ({out.stat().st_size:,} bytes); artists {len(data["artists"])}, '
      f'albums {sum(len(a["albums"]) for a in data["artists"])}, images {len(data["img"])}')
