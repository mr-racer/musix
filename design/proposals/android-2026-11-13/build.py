"""Build the offline, single-file phone review from frozen library data.

No API calls, credentials, or production writes. Album artwork stays in ignored output.
"""
from pathlib import Path
import base64
import json
import re
import sqlite3
import argparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', type=Path, default=Path('/mnt/data/musix-snapshots/2026-11-13-android-rebuild/data.json'))
args = parser.parse_args()

def inline_font(family, stem, weights, subsets, style='normal'):
    rules = []
    for weight in weights:
        for subset in subsets:
            path = ROOT / f'web/node_modules/@fontsource/{stem}/files/{stem}-{subset}-{weight}-{style}.woff2'
            data = base64.b64encode(path.read_bytes()).decode()
            codepoints = 'U+0400-052F,U+2DE0-2DFF,U+A640-A69F' if subset == 'cyrillic' else 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
            rules.append(f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};font-display:swap;src:url(data:font/woff2;base64,{data}) format('woff2');unicode-range:{codepoints}}}")
    return '\n'.join(rules)

fonts = inline_font('Geist', 'geist', [400, 500, 600, 700], ['latin', 'cyrillic'])
fonts += inline_font('Noto Sans', 'noto-sans', [400, 600], ['latin', 'cyrillic'])
fonts += inline_font('Noto Sans', 'noto-sans', [400], ['latin', 'cyrillic'], 'italic')
fonts += inline_font('JetBrains Mono', 'jetbrains-mono', [400], ['latin', 'cyrillic'])
data = json.loads(args.snapshot.read_text())
icons = {}
for line in (ROOT / 'web/src/ui/icons.tsx').read_text().splitlines():
    match = re.match(r'\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$', line)
    if match:
        icons[match[1]] = {'d': json.loads(match[2]), 'w': float(match[3]), 'fill': json.loads(match[4])}

css = '\n'.join([fonts, (ROOT / 'design/gen/web/tokens.css').read_text(),
                  (HERE / 'glass.css').read_text(), (HERE / 'phone.css').read_text(),
                  (HERE / 'refinement.css').read_text(), (HERE / 'home.css').read_text()])
script = 'window.PHONE_DATA=' + json.dumps(data, ensure_ascii=False) + ';\n'
script += 'window.ICONS=' + json.dumps(icons) + ';\n'
script += (HERE / 'vendor/tactile-lib.js').read_text() + '\n'
script += (HERE / 'assistant.js').read_text() + '\n' + (HERE / 'home-sky.js').read_text() + '\n' + (HERE / 'home.js').read_text() + '\n' + (HERE / 'phone.js').read_text()
page = (HERE / 'phone.html').read_text().replace('/* INLINE_CSS */', css).replace('/* INLINE_JS */', script.replace('</script', '<\\/script'))
out = HERE / 'out'
out.mkdir(exist_ok=True)
(out / 'android-review.html').write_text(page)
(out / 'android-home-review.html').write_text(
    page.replace('<body>', '<body data-review-focus="home">')
        .replace('<title>MusiX · Android: Dream и экраны</title>', '<title>MusiX · Android: главная, первый разбор</title>'))

# The accepted showcase is available verbatim for comparison, with local fonts.
showcase = (HERE / 'vendor/showcase.html').read_text()
showcase = re.sub(r'<link[^>]*>', '', showcase)
showcase = showcase.replace('</head>', '<style>' + fonts + (HERE / 'vendor/tactile.css').read_text() + (HERE / 'vendor/showcase.css').read_text() + '</style></head>')
showcase = showcase.replace('<script src="lib.js"></script>', '<script>' + (HERE / 'vendor/tactile-lib.js').read_text() + '</script>')
showcase = showcase.replace('<script src="showcase.js"></script>', '<script>' + (HERE / 'vendor/tactile-showcase.js').read_text() + '</script>')
(out / 'accepted-showcase.html').write_text(showcase)

# Home, round 2: the same shell with its own home section, styles and scripts. Round 1 above
# is left byte for byte as it was; round 2 files that do not exist yet are simply empty.
def optional(name):
    path = HERE / name
    return path.read_text() if path.exists() else ''

albums = json.loads((args.snapshot.parent / 'albums.json').read_text())
r2_css = '\n'.join([fonts, (ROOT / 'design/gen/web/tokens.css').read_text(),
                     (HERE / 'glass.css').read_text(), (HERE / 'phone.css').read_text(),
                     (HERE / 'refinement.css').read_text(), optional('home-r2.css'), optional('album-day.css')])
r2_script = 'window.PHONE_DATA=' + json.dumps(data, ensure_ascii=False) + ';\n'
r2_script += 'window.PHONE_ALBUMS=' + json.dumps(albums, ensure_ascii=False) + ';\n'
r2_script += 'window.ICONS=' + json.dumps(icons) + ';\n'
r2_script += (HERE / 'vendor/tactile-lib.js').read_text() + '\n'
r2_script += '\n'.join([(HERE / 'assistant.js').read_text(), (HERE / 'home-sky.js').read_text(),
                         optional('album-day-model.js'), optional('morph-menu.js'), optional('album-day.js'),
                         (HERE / 'home-r2.js').read_text(), (HERE / 'phone.js').read_text()])
shell = re.sub(r'<section id="page-home"[\s\S]*?(?=\s*<section id="page-library")', lambda _: (HERE / 'home-r2.html').read_text().strip(),
               (HERE / 'phone.html').read_text(), count=1)
r2 = shell.replace('/* INLINE_CSS */', r2_css).replace('/* INLINE_JS */', r2_script.replace('</script', '<\\/script'))
r2 = r2.replace('<body>', '<body data-review-focus="home-r2">').replace(
    '<title>MusiX · Android: Dream и экраны</title>', '<title>MusiX · Android: главная, раунд 2</title>')
(out / 'android-home-r2.html').write_text(r2)
print(f'Built {out / "android-review.html"}: {len(page.encode()) // 1024} KiB, {len(data["tracks"])} real tracks; no external assets')
