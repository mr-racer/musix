"""Assemble the probe page: styles.css + markup.html + logic.js + covers.json -> player-kino.html.
covers.json is not committed (album art); make it with bake_assets.py from local cover files."""
import json
css = open('styles.css').read(); html = open('markup.html').read(); js = open('logic.js').read()
js = js.replace('__COVERS__', json.dumps(json.load(open('covers.json')), separators=(',', ':')))
icons = ('arrow_upward,auto_awesome,chevron_left,chevron_right,close,expand_more,home,library_music,'
         'local_fire_department,lyrics,music_off,pause,play_arrow,play_circle,queue_music,shuffle,sports_esports,water_drop')
head = ('<title>Пробы дизайна MusiX</title>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=JetBrains+Mono&amp;family=Noto+Sans:ital,wght@0,400;0,500;1,400&amp;display=swap">\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&amp;icon_names=' + icons + '&amp;display=block">\n')
page = head + '<style>\n' + css + '</style>\n' + html + '<script>\n' + js + '</script>\n'
open('player-kino.html', 'w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body>' + page + '</body></html>')
print('built player-kino.html', len(page) // 1024, 'KB')
