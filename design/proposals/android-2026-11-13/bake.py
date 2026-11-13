"""Freeze the existing read-only metadata and sound mock export in the snapshot tree."""
import base64
import io
import json
from pathlib import Path
import sqlite3
from PIL import Image, ImageFilter

source = Path('/mnt/data/.cache/musix-stage-mock/data.js').read_text()
raw = json.loads(source.removeprefix('window.MOCK_DATA = ').strip().removesuffix(';'))
db = sqlite3.connect('file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1', uri=True)
db.row_factory = sqlite3.Row
tracks = []
for track in raw:
    row = db.execute('select track_id,album,year,genre,producer from track_metadata where lower(title)=lower(?) and lower(artist)=lower(?) limit 1', (track['title'], track['artist'])).fetchone()
    row = dict(row) if row else {}
    vibe = db.execute("select phrase from sonic_vibes where track_id=? and lang='ru' limit 1", (row.get('track_id', ''),)).fetchone()
    image = Image.open(io.BytesIO(base64.b64decode(track['cover']))).convert('RGB').resize((240, 240)).filter(ImageFilter.GaussianBlur(6))
    buffer = io.BytesIO()
    image.save(buffer, 'JPEG', quality=80)
    sound = {k: v for k, v in track['sound'].items() if k not in ['stage', 'stems']}
    tracks.append(dict(id=track['id'], t=track['title'], a=track['artist'], d=track['durationMs'] / 1000,
                       album=row.get('album', ''), year=row.get('year'), genre=row.get('genre'), producer=row.get('producer'),
                       cover='data:image/webp;base64,' + track['cover'], bg='data:image/webp;base64,' + track['bg'],
                       blur='data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode(),
                       palette=track['palette'], vibe=vibe['phrase'] if vibe else '', sound=sound))
out = Path('/mnt/data/musix-snapshots/2026-11-13-android-rebuild')
out.mkdir(exist_ok=True)
(out / 'data.json').write_text(json.dumps({'source': {'metadata': '2026-10-01/metadata.db',
    'sound': '2026-11-11-stage-mock (frozen export from 2026-10-25)', 'audio': 'simulated; no audio is embedded'}, 'tracks': tracks}, ensure_ascii=False))
print('Snapshot:', out / 'data.json')
