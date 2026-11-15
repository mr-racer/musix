"""Bake the data of the phone artist + album review from frozen, read-only sources.

usage: python3 bake.py OUT_DIR
  - the v1 snapshot of 2026-10-01 (metadata.db, opened read-only and immutable) and v1's image tree:
    the eight artists' albums with every song, plays, the last play, producers and labels from the tags;
  - the export of the approved artist mock (/mnt/data/.cache/musix-artist-mock/out): Apple photos and logos,
    bios, Grammys, the level story;
  - design/reference/artist/edit_block.js: the hand edits of that mock (cities, original years, facts in Russian).
Nothing from prod, the database server or the API is read. Writes OUT_DIR/data.json and OUT_DIR/img/*.
"""
import json
import re
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

OUT = Path(sys.argv[1])
IMG = OUT / 'img'
IMG.mkdir(parents=True, exist_ok=True)
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
V1 = Path('/mnt/data/lyrics-search/frontend')
MOCK = Path('/mnt/data/.cache/musix-artist-mock/out')
C = 'acct_c2b5b12d55d341feb0940929e5a12c0d'
db = sqlite3.connect('file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1', uri=True)

GENRE = {'Hip-Hop': 'Хип-хоп', 'Hip Hop': 'Хип-хоп', 'Rap': 'Рэп', 'Pop': 'Поп', 'Rock': 'Рок', 'R&B': 'R&B',
         'Electronic': 'Электроника', 'Alternative': 'Альтернатива', 'Indie': 'Инди', 'Soul': 'Соул'}
EDITION = re.compile(r'\s*[(\[]([^)\]]*(?:Edition|Deluxe|Version|Remaster|Tour|Anniversary|Expanded)[^)\]]*)[)\]]\s*$', re.I)
CYR = re.compile('[А-Яа-яЁё]')
# formedYear is also set for solo artists (Gaga's first band, the Jackson 5): «Группа собралась» only for real bands
BANDS = {'arctic-monkeys', 'maroon-5', 'nothing-but-thieves'}


def edits():
    """COUNTRY and EDIT of the approved mock: a JS literal, evaluated by node once."""
    src = ROOT / 'design/reference/artist/edit_block.js'
    js = f"const fs=require('fs');eval(fs.readFileSync({json.dumps(str(src))},'utf8')+';globalThis.R={{COUNTRY,EDIT}}');process.stdout.write(JSON.stringify(R))"
    node = Path.home() / '.local/bin/node'
    return json.loads(subprocess.run([str(node) if node.exists() else 'node', '-e', js], capture_output=True, text=True, check=True).stdout)


def save(im: Image.Image, name: str, px: int, q: int = 80) -> str:
    im = im.convert('RGB')
    if im.width > px:
        im = im.resize((px, round(px * im.height / im.width)), Image.LANCZOS)
    im.save(IMG / f'{name}.jpg', quality=q, optimize=True, progressive=True)
    return name


def vibrant(im: Image.Image) -> str:
    """The most saturated of the image's common colours (stands in for the server palette)."""
    q = im.convert('RGB').resize((64, 64)).quantize(12, method=Image.Quantize.MEDIANCUT).convert('RGB')
    best, score = (200, 160, 90), -1.0
    for n, (r, g, b) in q.getcolors(4096) or []:
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / (mx or 1)
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        s = sat * (0.25 + min(lum, 0.7)) * (n ** 0.35)
        if 0.12 < lum < 0.85 and s > score:
            best, score = (r, g, b), s
    return '#%02x%02x%02x' % best


def field(im: Image.Image, name: str) -> str:
    """The page's colour field: the cover blurred until no shape is left (the gatefold's right page)."""
    f = im.convert('RGB').resize((96, 96), Image.LANCZOS).filter(ImageFilter.GaussianBlur(14))
    f = ImageEnhance.Color(f).enhance(1.35)
    f.resize((48, 48), Image.LANCZOS).save(IMG / f'{name}-f.jpg', quality=88)
    return f'{name}-f'


covers = {}


def cover(path):
    """A cover in three sizes: 640 (the album), 300 (the axis and the stack), the colour field."""
    if not path:
        return None
    src = V1 / path.lstrip('/')
    if not src.exists():
        return None
    key = 'c-' + src.stem
    if key not in covers:
        im = Image.open(src).convert('RGB')
        save(im, key, 640, 80)
        save(im, key + '-s', 300, 80)
        field(im, key)
        covers[key] = vibrant(im)
    return key


def split_names(s):
    return [x.strip() for x in re.split(r',\s*|\s+&\s+|;\s*', s or '') if x.strip()]


def producers(rows, me):
    parts = set(me.lower().split())
    c = Counter()
    for r in rows:
        for n in split_names(r['producer']):
            if n.lower() == me.lower() or n.lower() in parts or 'youtuber' in n.lower():
                continue
            c[n] += 1
    got = [n for n, k in c.most_common() if k >= 2] or [n for n, _ in c.most_common()]
    return got[:4]


def label(rows):
    c = Counter(r['label'] for r in rows if r['label'])
    if not c:
        return None
    parts = split_names(c.most_common(1)[0][0].replace('A & M', 'A&M'))
    latin = [p for p in parts if not CYR.search(p)]
    return (latin or parts)[0]


E = edits()
mock = json.loads((MOCK / 'data.json').read_text())
lib_rank = sorted(mock['grammyLib'], key=lambda g: -g['wins'])
out = {'artists': [], 'laureates': len(lib_rank), 'libArtists': mock['libArtists'], 'country': E['COUNTRY']}

for a in mock['artists']:
    slug, name = a['slug'], a['name']
    e = E['EDIT'].get(slug, {})
    rows = [dict(zip(('id', 'title', 'artists', 'album', 'year', 'genre', 'dur', 'producer', 'label', 'no', 'disc', 'cover', 'plays', 'last'), r))
            for r in db.execute("""select t.track_id, t.title, t.artists, t.album, t.year, t.genre, t.duration, t.producer, t.label,
                t.track_number, t.disc_number, t.cover_art_path,
                (select count(*) from playback_events pe where pe.collection_name=t.collection_name and pe.track_id=t.track_id and pe.skipped_early=0),
                (select max(played_at) from playback_events pe where pe.collection_name=t.collection_name and pe.track_id=t.track_id and pe.skipped_early=0)
                from track_metadata t where t.collection_name=? and t.primary_artist_slug=?""", (C, slug))]
    by_album = defaultdict(list)
    for r in rows:
        by_album[r['album'] or '—'].append(r)
    albums = []
    for title, rs in by_album.items():
        if len(rs) < 3:
            continue
        rs.sort(key=lambda r: (r['disc'] or 1, r['no'] or 999, r['title']))
        m = EDITION.search(title) or re.search(r'\s*,?\s*-\s*(EP)$', title)
        years = [r['year'] for r in rs if r['year']]
        cov = next((cover(r['cover']) for r in rs if r['cover']), None)
        tracks = []
        for r in rs:
            feat = [x for x in json.loads(r['artists'] or '[]')[1:] if x != name]
            if re.search(r'\bfeat', r['title'], re.I):
                feat = []
            tracks.append({'id': r['id'], 't': r['title'], 'no': r['no'], 'disc': r['disc'] or 1, 'd': round(r['dur'] or 0),
                           'plays': r['plays'], 'feat': feat[:2]})
        lasts = [r['last'] for r in rs if r['last']]
        albums.append({
            'id': f'{slug}:{len(albums)}', 'title': title,
            'clean': title[:m.start()].rstrip(', ') if m else title,
            'ed': (m.group(1).replace('Australian Tour Edition', 'Tour Edition').replace('Expanded Edition', 'Expanded') if m else None),
            'year': (e.get('years') or {}).get(title) or (min(years) if years else None),
            'genre': GENRE.get(Counter(r['genre'] for r in rs if r['genre']).most_common(1)[0][0], None) if any(r['genre'] for r in rs) else None,
            'cover': cov, 'tint': covers.get(cov), 'n': len(rs), 'heard': sum(r['plays'] > 0 for r in rs),
            'plays': sum(r['plays'] for r in rs), 'last': max(lasts)[:10] if lasts else None,
            'producers': producers(rs, name), 'label': label(rs), 'tracks': tracks,
        })
    albums.sort(key=lambda x: (x['year'] or 9999, x['clean']))
    for i, al in enumerate(albums):
        al['id'] = f'{slug}:{i}'
    # the picture: Apple's square editorial photo, else the old one (Kanye's Apple profile is a black square)
    ap = a.get('apple') or {}
    src = MOCK / 'img' / f"{ap['sq'] if ap.get('sq') else a['photo']}.jpg"
    ph = Image.open(src).convert('RGB')
    photo = save(ph, f'{slug}-ph', 900, 82)
    save(ph, f'{slug}-ph-s', 360, 80)
    ph.resize((24, 24), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.5)).save(IMG / f'{slug}-ph-t.jpg', quality=70)
    logo = None
    if ap.get('logo'):
        lg = Image.open(MOCK / 'img' / f"{ap['logo']}.png").convert('RGBA')
        lg = lg.resize((560, round(560 * lg.height / lg.width)), Image.LANCZOS)
        lg.save(IMG / f'{slug}-logo.png', optimize=True)
        logo = f'{slug}-logo'
    bio = (a.get('bio') or '').replace('\n', ' ')
    bio = re.sub(r'The bio facts are confirmed[^.]*\.\s*I will now write[^.]*\.\s*', '', bio, flags=re.I)
    bio = re.sub(r'\*([^*]+)\*', r'\1', bio)
    bio = re.sub(r'\s+', ' ', bio).strip()
    bio = re.sub(r'[\s*_]*' + re.escape(name) + r'[\s*_]*$', '', bio)
    status = (a.get('status') or '').lower()
    dead = bool(re.search(r'deceased|died|умер|скончал', status))
    first = next((al['year'] for al in albums if al['year']), None)
    af = a.get('activeFrom')
    formed = a.get('formedYear') or (af if af and (not first or af <= first) else None)
    w = a.get('grammyWins') or 0
    pos = next((i + 1 for i, g in enumerate(lib_rank) if g['name'] == name), None)
    out['artists'].append({
        'slug': slug, 'name': name, 'cc': a['cc'], 'city': e.get('city'), 'genre': GENRE.get(a.get('genre'), a.get('genre')),
        'formed': formed, 'band': slug in BANDS,'start': min(x for x in (formed, first) if x) if (formed or first) else None,
        'end': a.get('activeTo') if dead else None, 'dead': dead,
        'grammy': {'wins': w, 'noms': a.get('grammyNoms'), 'pos': pos} if (w or a.get('grammyNoms')) else None,
        'bio': bio, 'nameOrigin': a.get('nameOrigin'), 'facts': e.get('facts') or [],
        'photo': photo, 'logo': logo, 'page': ap.get('bg') or '#111111', 'tint': a.get('tint'),
        'plays': a['plays'], 'tracks': a['tracks'], 'heardAll': a.get('heardAll'), 'rank': a.get('rank'),
        'story': a.get('story'), 'albums': albums,
    })
    print(f'{slug}: {len(albums)} albums, {sum(x["n"] for x in albums)} songs, grammy {w}, pos {pos}, formed {formed}, dead {dead}, logo {bool(logo)}')

(OUT / 'data.json').write_text(json.dumps(out, ensure_ascii=False))
size = sum(p.stat().st_size for p in IMG.iterdir())
print(f'{OUT / "data.json"}: {(OUT / "data.json").stat().st_size // 1024} KB; img {len(list(IMG.iterdir()))} files, {size // 1024} KB')
