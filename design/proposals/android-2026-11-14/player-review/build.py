"""Build the offline phone player review. Artwork and outputs stay outside Git."""
from pathlib import Path
import argparse
import base64
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, default=Path('/mnt/data/musix-snapshots/2026-11-14-android-player-review'))
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


def glyphs():
    """Instrument glyphs of the web player: shapes and the key → shape table."""
    src = (ROOT / 'web/src/player/glyphs.tsx').read_text()
    shapes = {}
    for name, body in re.findall(r'const (\w+): Glyph = \[(.*?)\];', src, re.S):
        shapes[name] = [dict(d=d, fill=bool(f)) for d, f in re.findall(r'\{ d: "([^"]+)"(, fill: true)? \}', body)]
    table = re.search(r'const BY: Record<string, Glyph> = \{(.*?)\};', src, re.S)[1]
    by = dict(re.findall(r'(\w+): (\w+)', table))
    return dict(shapes=shapes, by=by)


def uri(path: Path):
    kind = 'webp' if path.suffix == '.webp' else 'jpeg'
    return f'data:image/{kind};base64,' + base64.b64encode(path.read_bytes()).decode()


def tracks():
    """Songs, covers, backdrops and sound profiles from the frozen read-only export of 2026-10-25."""
    cache = Path('/mnt/data/.cache/musix-sound-mock/out')
    data = json.JSONDecoder().raw_decode((cache / 'data.js').read_text().removeprefix('window.MX='))[0]
    order = ['Frozen', 'Exits', 'Power', 'Million and One', 'Black Skinhead', 'Diamonds from Sierra Leone']
    by_title = {s['title']: s for s in data['songs']}
    out, extra, seen = [], [], set()
    for title in order:
        s = by_title[title]
        api = s['api']
        out.append(dict(
            id=s['id'], t=s['title'], a=s['artist'], album=s['album'], year=s['year'], genre=s['genre'], d=s['dur'],
            cover=uri(cache / s['cover']), bg=uri(cache / s['bg']),
            accent=s['palette']['accent'], pal={k: s['palette'][k] for k in ('vibrant', 'dominant', 'muted')},
            vibe=(s.get('vibe') or {}).get('phrase'), facts=s.get('facts') or [], credits=s.get('credits') or [],
            sound=dict(ratings=api['ratings'], instruments=api['instruments'], drums=api['drums'], vocals=api['vocals'],
                       pace=api['pace'], feel=api['feel'], echo=api['echo'], width=api['width'],
                       sections=api['sections'], moments=api['moments'], signature=s.get('signature')),
            stems=[{k: x[k] for k in ('name', 'stem', 'pan', 'width')} for x in s['profile']['stems']],
            share={k[6:]: v for k, v in s['feat'].items() if k.startswith('share.')},
            fill=s['feat'].get('fill'), bpm=s['profile'].get('felt_bpm')))
        for x in s.get('like') or []:
            if x['title'] not in seen and (cache / x['cover']).is_file():
                seen.add(x['title'])
                extra.append(dict(t=x['title'], a=x['artist'], cover=uri(cache / x['cover'])))
    return dict(tracks=out, extra=extra[:14])


data = tracks()
labels = sorted({l for t in data['tracks'] for f in t['facts'] for l in f.get('labels', [])})
css = fonts() + '\n' + (HERE / 'style.css').read_text()
# Richbox for the assistant's steps: the accepted mishanaer component, taken unchanged from the vendored
# showcase library (MIT) and closed in its own scope so that only createRichbox comes out.
VENDOR = HERE.parents[1] / 'android-2026-11-13/vendor/tactile-lib.js'
richbox = 'const createRichbox=(()=>{\n' + VENDOR.read_text() + '\nreturn createRichbox;\n})();\n'
script = '(()=>{\n"use strict";\n' + richbox + 'const DATA=' + json.dumps(data, ensure_ascii=False) + ';\nconst ICONS=' + json.dumps(icons()) \
    + ';\nconst GLYPHS=' + json.dumps(glyphs()) + ';\n'
for name in ('core.js', 'player.js', 'sheets.js', 'review.js'):
    script += f'\n/* ---- {name} ---- */\n' + (HERE / name).read_text()
script += '\n})();'
page = (HERE / 'review.html').read_text().replace('/* INLINE_CSS */', css)
page = page.replace('<!-- PHONE -->', (HERE / 'phone.html').read_text())
page = page.replace('/* INLINE_JS */', script.replace('</script', '<\\/script'))
out = args.out / 'android-player-review.html'
out.write_text(page)
print(f'Built {out} ({out.stat().st_size:,} bytes); tracks {len(data["tracks"])}, extra {len(data["extra"])}, fact labels {labels}')
