"""Bake the probe's image assets from local cover files (album art is not committed).

usage: python bake_assets.py sia=/path/cover.jpg lorde=/path/cover.jpg ...   ->   covers.json
The keys the probe expects: sia lorde tame lana kanye daft (see the track list in logic.js).

Per cover: `uri` (360 px JPEG, the cover itself), `acc`/`acc2` (accent pair from the palette),
`bg` and `bgc` (pre-blurred backdrops). `bgc` is the backdrop recipe of the approved player:
192 px, Gaussian blur 4.6 px, saturation x1.4, then highlights are tamed: luma above 0.30 grows
0.18x as fast, hue kept. Light covers stay readable under light text and nothing is laid on top.
The server's backdrop variant follows this recipe (spec 2026-10-04, section 6)."""
import base64, colorsys, io, json, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


def uri(im, q=72):
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


def tame(im, knee, slope):
    a = np.asarray(im).astype(np.float32) / 255
    luma = a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722
    out = np.where(luma > knee, knee + (luma - knee) * slope, luma)
    a = a * (out / np.maximum(luma, 1e-4))[..., None]
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def backdrop(im, size, blur, sat, knee, slope):
    soft = im.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))
    return tame(ImageEnhance.Color(soft).enhance(sat), knee, slope)


def accents(im):
    q = im.resize((48, 48)).quantize(8, method=Image.MEDIANCUT); pal = q.getpalette()[:24]; c = []
    for n, idx in sorted(q.getcolors(), reverse=True):
        r, g, b = [v / 255 for v in pal[idx * 3:idx * 3 + 3]]; h, l, s = colorsys.rgb_to_hls(r, g, b)
        c.append((s * (0.35 + min(l, 1 - l)) * (n ** 0.35), h, l, s))
    c.sort(reverse=True)
    fx = lambda h, s, L: '#%02x%02x%02x' % tuple(int(v * 255) for v in colorsys.hls_to_rgb(h, L, min(max(s, .38), .62)))
    a = c[0]; b2 = next((x for x in c[1:] if min(abs(x[1] - a[1]), 1 - abs(x[1] - a[1])) > .08), c[1])
    return fx(a[1], a[3], .66), fx(b2[1], b2[3], .52)


out = {}
for arg in sys.argv[1:]:
    key, path = arg.split('=', 1); im = Image.open(path).convert('RGB'); acc, acc2 = accents(im)
    out[key] = {'uri': uri(im.resize((360, 360), Image.LANCZOS), 70), 'acc': acc, 'acc2': acc2,
                'bg': uri(backdrop(im, 128, 6.3, 1.3, .45, .35)), 'bgc': uri(backdrop(im, 192, 4.6, 1.4, .30, .18))}
json.dump(out, open('covers.json', 'w'))
print('covers.json:', ', '.join(out))
