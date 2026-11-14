"""Freeze the track lists of the snapshot's four albums for the round 2 album of the day.

Read-only, immutable SQLite snapshot; the result stays outside git, next to data.json."""
import json
import sqlite3
from pathlib import Path

snap = Path('/mnt/data/musix-snapshots/2026-11-13-android-rebuild')
data = json.loads((snap / 'data.json').read_text())
db = sqlite3.connect('file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1', uri=True)
albums = {}
for track in data['tracks']:
    rows = db.execute(
        'select title, duration, track_number from track_metadata where album = ? and artist = ? '
        'order by coalesce(disc_number, 1), track_number', (track['album'], track['a'])).fetchall()
    albums[track['id']] = dict(album=track['album'], artist=track['a'], year=track.get('year'),
                               tracks=[dict(t=t, d=round(d or 0), n=n) for t, d, n in rows])
(snap / 'albums.json').write_text(json.dumps(albums, ensure_ascii=False))
for v in albums.values():
    print(v['album'], len(v['tracks']))
