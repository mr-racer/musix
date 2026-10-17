#!/bin/bash
# Apple Music artist images: square (2400) + wide (3000x1500) + logo; args: slug "search term"
cd "$1"; shift
while [ $# -gt 1 ]; do
  slug=$1; term=$2; shift 2
  [ -f am-$slug.html ] || { url=$(curl -s -4 -m 20 "https://itunes.apple.com/search?term=${term// /+}&entity=musicArtist&limit=1" | python3 -I -c "import json,sys; print(json.load(sys.stdin)['results'][0]['artistLinkUrl'].split('?')[0])" 2>/dev/null); [ -z "$url" ] && { echo "$slug: no link"; sleep 6; continue; }; curl -s -4 -m 30 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" "$url" -o am-$slug.html; }
  python3 -I - am-$slug.html $slug <<'PY'
import re,sys,json
h=open(sys.argv[1]).read()
d=json.loads(re.search(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>',h,re.S).group(1))
it=d['data'][0]['data']['sections'][0]['items'][0]
out={}
for k in ['artwork','wideArtwork','artistLogo']:
    v=it.get(k)
    if v and isinstance(v,dict) and 'dictionary' in v:
        a=v['dictionary']; out[k]={'url':a['url'],'w':a.get('width'),'h':a.get('height'),'bg':a.get('bgColor'),'t1':a.get('textColor1'),'t2':a.get('textColor2')}
json.dump(out,open(sys.argv[2]+'.am.json','w'))
print(sys.argv[2], {k:(v['w'],v['h']) for k,v in out.items()})
PY
  python3 -I - $slug <<'PY' | while read kind u; do curl -s -4 -m 60 "$u" -o "am2-$slug-$kind"; done
import json,sys
s=sys.argv[1]; d=json.load(open(s+'.am.json'))
def u(x,w,h,ext): b=x['url'].split('{w}')[0]; return f"{b}{w}x{h}bb.{ext}"
if 'artwork' in d: print('sq.jpg', u(d['artwork'],1600,1600,'jpg'))
if 'wideArtwork' in d and d['wideArtwork']['w']!=d['wideArtwork']['h']: print('wide.jpg', u(d['wideArtwork'],3000,1500,'jpg'))
if 'artistLogo' in d: print('logo.png', u(d['artistLogo'],1440,int(1440*d['artistLogo']['h']/d['artistLogo']['w']),'png'))
PY
  sleep 5
done
