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

def inline_font(family, stem, weights, subsets):
    rules = []
    for weight in weights:
        for subset in subsets:
            path = ROOT / f'web/node_modules/@fontsource/{stem}/files/{stem}-{subset}-{weight}-normal.woff2'
            data = base64.b64encode(path.read_bytes()).decode()
            codepoints = 'U+0400-052F,U+2DE0-2DFF,U+A640-A69F' if subset == 'cyrillic' else 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
            rules.append(f"@font-face{{font-family:'{family}';font-style:normal;font-weight:{weight};font-display:swap;src:url(data:font/woff2;base64,{data}) format('woff2');unicode-range:{codepoints}}}")
    return '\n'.join(rules)

fonts = inline_font('Geist', 'geist', [400, 500, 600, 700], ['latin', 'cyrillic'])
fonts += inline_font('Noto Sans', 'noto-sans', [400], ['latin', 'cyrillic'])
fonts += inline_font('JetBrains Mono', 'jetbrains-mono', [400], ['latin', 'cyrillic'])
data = json.loads(args.snapshot.read_text())
icons = {}
for line in (ROOT / 'web/src/ui/icons.tsx').read_text().splitlines():
    match = re.match(r'\s+(\w+): \{ d: (\[.*\]), w: ([\d.]+), fill: (\[.*\]) \},?$', line)
    if match:
        icons[match[1]] = {'d': json.loads(match[2]), 'w': float(match[3]), 'fill': json.loads(match[4])}

css = '\n'.join([fonts, (ROOT / 'design/gen/web/tokens.css').read_text(),
                  (HERE / 'glass.css').read_text(), (HERE / 'phone.css').read_text()])
script = 'window.PHONE_DATA=' + json.dumps(data, ensure_ascii=False) + ';\n'
script += 'window.ICONS=' + json.dumps(icons) + ';\n'
script += (HERE / 'vendor/tactile-lib.js').read_text() + '\n' + (HERE / 'phone.js').read_text()
page = (HERE / 'phone.html').read_text().replace('/* INLINE_CSS */', css).replace('/* INLINE_JS */', script.replace('</script', '<\\/script'))
out = HERE / 'out'
out.mkdir(exist_ok=True)
(out / 'android-review.html').write_text(page)

# The accepted showcase is available verbatim for comparison, with local fonts.
showcase = (HERE / 'vendor/showcase.html').read_text()
showcase = re.sub(r'<link[^>]*>', '', showcase)
showcase = showcase.replace('</head>', '<style>' + fonts + (HERE / 'vendor/tactile.css').read_text() + (HERE / 'vendor/showcase.css').read_text() + '</style></head>')
showcase = showcase.replace('<script src="lib.js"></script>', '<script>' + (HERE / 'vendor/tactile-lib.js').read_text() + '</script>')
showcase = showcase.replace('<script src="showcase.js"></script>', '<script>' + (HERE / 'vendor/tactile-showcase.js').read_text() + '</script>')
(out / 'accepted-showcase.html').write_text(showcase)
print(f'Built {out / "android-review.html"}: {len(page.encode()) // 1024} KiB, {len(data["tracks"])} real tracks; no external assets')
