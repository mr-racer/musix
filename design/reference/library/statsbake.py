"""Bake the statistics mock's numbers from the real listen history (nothing personal is
committed: the output lives in the scratchpad).

usage: python statsbake.py STATS_SRC.json MEDIA_ROOT OUT.json
  STATS_SRC.json  the export of q_stats.sql (events in local time, UTC+3)
Out: listening time, days and streaks, the favourite artist and song, hours, genres and
decades (listened and in the library), countries by listening time, and the ten
achievements with their best value, target, the day they were earned and a context."""
import base64, collections, datetime as dt, io, json, pathlib, sys
from PIL import Image

src = json.loads(pathlib.Path(sys.argv[1]).read_text())
root, out = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
TODAY = dt.date(2026, 10, 11)
GENRE = {"Rock": "Рок", "Pop": "Поп", "Hip-Hop": "Хип-хоп", "Hip Hop": "Хип-хоп", "Electronic": "Электроника",
         "Alternative": "Альтернатива", "R&B/Soul": "R&B и соул", "Soundtrack": "Саундтреки", "Nu-Metal": "Ню-метал"}

def cc(c):
    c = (c or "").strip().upper()
    return "GB" if c == "UK" else c if len(c) == 2 and c.isalpha() and c != "NY" else None

def uri(cid, px, top=0.5):
    if not cid: return None
    for v in ("512", "1024", "256"):
        p = root / "i" / cid[:2] / cid / f"{v}.webp"
        if p.exists(): break
    else: return None
    im = Image.open(p).convert("RGB"); w, h = im.size
    if h > w: y = int((h - w) * top); im = im.crop((0, y, w, y + w))
    elif w > h: x = (w - h) // 2; im = im.crop((x, 0, x + h, h))
    im = im.resize((px, px), Image.LANCZOS); b = io.BytesIO(); im.save(b, "JPEG", quality=82, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

T = {t[0]: dict(t=t[1], al=t[2], ar=t[3], y=t[4], g=GENRE.get(t[5] or "", "Другое"), ms=t[6], c=t[7], live=t[8], acc=t[9]) for t in src["tracks"]}
A = {a[0]: dict(name=a[1], img=a[2], cc=cc(a[3])) for a in src["artists"]}
AL = {a[0]: dict(t=a[1], c=a[2], n=a[3]) for a in src["albums"]}
ev = [(tid, dt.datetime.fromisoformat(ts), ms or 0, sk) for tid, ts, ms, sk in src["events"] if tid in T]
good = [e for e in ev if not e[3]]
day = lambda e: e[1].date()
since = ev[0][1].date()

# time, days, streaks
total_ms = sum(e[2] for e in ev)
per_day = collections.Counter(day(e) for e in ev)
cal, d, run, best, best_end = [], since, 0, 0, since
while d <= TODAY:
    cal.append([d.isoformat(), per_day.get(d, 0)])
    run = run + 1 if d in per_day else 0
    if run > best: best, best_end = run, d
    d += dt.timedelta(days=1)
cur, d = 0, TODAY if TODAY in per_day else TODAY - dt.timedelta(days=1)
while d in per_day: cur += 1; d -= dt.timedelta(days=1)

# favourites
by_artist = collections.Counter(T[e[0]]["ar"] for e in good)
ms_artist = collections.Counter(); [ms_artist.update({T[e[0]]["ar"]: e[2]}) for e in ev]
by_track = collections.Counter(e[0] for e in good)
ta, tt = by_artist.most_common(1)[0][0], by_track.most_common(1)[0][0]
hours = [0] * 24
for e in good: hours[e[1].hour] += 1
def share(counter):
    tot = sum(counter.values()) or 1
    return [[k, round(v / tot * 100, 1)] for k, v in counter.most_common() if k]
ms_genre, ms_dec, ms_cc = collections.Counter(), collections.Counter(), collections.Counter()
for e in ev:
    t = T[e[0]]; ms_genre[t["g"]] += e[2]
    if t["y"]: ms_dec[t["y"] // 10 * 10] += e[2]
    c = A.get(t["ar"], {}).get("cc"); ms_cc[c or "—"] += e[2]
lib = [t for t in T.values() if t["live"]]
lib_genre = collections.Counter(t["g"] for t in lib)
lib_dec = collections.Counter(t["y"] // 10 * 10 for t in lib if t["y"])

# achievements: the best value so far and the first day it reached the target
def first_day(metric_by_day, target):
    for d in sorted(metric_by_day):
        if metric_by_day[d] >= target: return d.isoformat()
    return None
ach = []
def add(id_, name, line, value, target, earned_on=None, ctx=None, unit=""):
    ach.append(dict(id=id_, name=name, line=line, value=value, target=target, earned=earned_on, ctx=ctx, unit=unit))
# 1 the same song five times in a day
rep = collections.Counter((day(e), e[0]) for e in good)
(rd, rt), rv = rep.most_common(1)[0]
add("repeat", "На репите", "Одна песня пять раз за день", rv, 5, first_day({d: max(v for (dd, _), v in rep.items() if dd == d) for d in {k[0] for k in rep}}, 5),
    {"text": T[rt]["t"] + " · " + str(rv) + " раз за " + rd.isoformat(), "cover": T[rt]["c"]})
# 2 two hundred songs in a day
pdg = collections.Counter(day(e) for e in good); md, mv = pdg.most_common(1)[0]
add("marathon", "Марафонец", "Двести песен за один день", mv, 200, first_day(pdg, 200), {"text": "рекорд — " + str(mv) + " за " + md.isoformat()})
# 3 thirty skips in a row
run = bestskip = 0; skip_day = None
for e in ev:
    run = run + 1 if e[3] else 0
    if run > bestskip: bestskip, skip_day = run, day(e)
add("picky", "Привереда", "Тридцать пропусков подряд", bestskip, 30, skip_day.isoformat() if bestskip >= 30 else None, {"text": "рекорд — " + str(bestskip) + " подряд"})
# 4 twenty songs between two and five at night
night = collections.Counter(day(e) for e in good if 2 <= e[1].hour < 5); nv = max(night.values() or [0])
add("night", "Ночная смена", "Двадцать песен между двумя и пятью ночи", nv, 20, first_day(night, 20), {"text": "рекорд — " + str(nv) + " за ночь"})
# 5 a whole album in a day, nothing skipped
seen = collections.defaultdict(set)
for e in good: seen[(day(e), T[e[0]]["al"])].add(e[0])
whole = sorted((d, al) for (d, al), s in seen.items() if al in AL and AL[al]["n"] >= 6 and len(s) >= AL[al]["n"])
add("whole", "От корки до корки", "Альбом целиком, ни одного пропуска", len({al for _, al in whole}), 1, whole[0][0].isoformat() if whole else None,
    {"text": AL[whole[0][1]]["t"], "cover": AL[whole[0][1]]["c"]} if whole else None)
# 6 seven days in a row
add("week", "Без выходных", "Семь дней подряд с музыкой", best, 7, (best_end - dt.timedelta(days=best - 7)).isoformat() if best >= 7 else None, {"text": "рекорд — " + str(best) + " дней"})
# 7 ten albums unwrapped (first heard after the library's first two weeks)
first = {}
for e in good:
    al = T[e[0]]["al"]
    if al and al not in first: first[al] = day(e)
late = sorted(d for d in first.values() if d >= since + dt.timedelta(days=14))
add("unwrap", "Распаковщик", "Распечатать десять альбомов", len(late), 10, late[9].isoformat() if len(late) >= 10 else None, {"text": str(len(late)) + " распечатано"})
# 8 five decades in a day
decs = collections.defaultdict(set)
for e in good:
    if T[e[0]]["y"]: decs[day(e)].add(T[e[0]]["y"] // 10)
dv = max(len(s) for s in decs.values())
add("time", "Машина времени", "Пять десятилетий за один день", dv, 5, first_day({d: len(s) for d, s in decs.items()}, 5), {"text": "рекорд — " + str(dv) + " за день"})
# 9 three hours of one artist in a day
am = collections.Counter()
for e in ev: am[(day(e), T[e[0]]["ar"])] += e[2]
(ad, aa), av = am.most_common(1)[0]
add("one", "Однолюб", "Три часа одного артиста за день", round(av / 3.6e6, 1), 3, first_day({d: max(v for (dd, _), v in am.items() if dd == d) / 3.6e6 for d in {k[0] for k in am}}, 3),
    {"text": A.get(aa, {}).get("name", "") + " · " + str(round(av / 3.6e6, 1)).replace(".", ",") + " ч за " + ad.isoformat()}, "ч")
# 10 artists from ten countries in a week
wk = collections.defaultdict(set)
for e in good:
    c = A.get(T[e[0]]["ar"], {}).get("cc")
    if c: wk[e[1].isocalendar()[:2]].add(c)
gv = max(len(s) for s in wk.values())
gfirst = next((dt.date.fromisocalendar(y, w, 7).isoformat() for (y, w), s in sorted(wk.items()) if len(s) >= 10), None)
add("globe", "Кругосветка", "Артисты из десяти стран за неделю", gv, 10, gfirst, {"text": "рекорд — " + str(gv) + " стран за неделю"})

top3a = [dict(name=A[a]["name"], hours=round(ms_artist[a] / 3.6e6, 1), plays=n, share=round(ms_artist[a] / total_ms * 100, 1), img=uri(A[a]["img"], 520, 0.22)) for a, n in by_artist.most_common(3)]
top3t = [dict(t=T[t]["t"], ar=A.get(T[t]["ar"], {}).get("name", ""), plays=n, cover=uri(T[t]["c"], 520), acc=T[t]["acc"]) for t, n in by_track.most_common(3)]
years = collections.Counter(t["y"] for t in lib if t["y"] and 1950 <= t["y"] <= TODAY.year)
res = dict(since=since.isoformat(), today=TODAY.isoformat(), total_ms=total_ms, plays=len(ev), finished=len(good), days=len(per_day), span=len(cal),
           cal=cal, streak=cur, best=best, hours=hours,
           artist=dict(name=A[ta]["name"], plays=by_artist[ta], hours=round(ms_artist[ta] / 3.6e6, 1), share=round(ms_artist[ta] / total_ms * 100), cc=A[ta]["cc"], img=uri(A[ta]["img"], 560, 0.22)),
           track=dict(t=T[tt]["t"], ar=A.get(T[tt]["ar"], {}).get("name", ""), plays=by_track[tt], cover=uri(T[tt]["c"], 560)),
           top_artists=top3a, top_tracks=top3t, years=sorted(years.items()),
           avg_day_ms=round(total_ms / len(per_day)), finished_pct=round(len(good) / len(ev) * 100),
           listened=dict(genres=share(ms_genre), decades=share(ms_dec), countries=share(ms_cc)),
           library=dict(genres=share(lib_genre), decades=share(lib_dec), tracks=len(lib)),
           ach=ach)
for a in ach:
    if a["ctx"] and a["ctx"].get("cover"): a["ctx"]["cover"] = uri(a["ctx"]["cover"], 160)
out.write_text(json.dumps(res, ensure_ascii=False))
print(out, out.stat().st_size // 1024, "KB")
print("time h", round(total_ms / 3.6e6, 1), "days", len(per_day), "of", len(cal), "streak", cur, "best", best)
print("artist", res["artist"]["name"], res["artist"]["hours"], "h", res["artist"]["share"], "%; track", res["track"]["t"], res["track"]["plays"])
for a in ach: print(f'  {a["name"]:18} {a["value"]}/{a["target"]} earned={a["earned"]}  {a["ctx"] and a["ctx"]["text"]}')
print("listened genres", res["listened"]["genres"][:4], "decades", res["listened"]["decades"][:3], "countries", res["listened"]["countries"][:4])
print("hours peak", max(range(24), key=lambda h: hours[h]))
