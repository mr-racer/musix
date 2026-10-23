"""Bake the assistant mock's data from the frozen v1 snapshot of 2026-10-01 (read-only,
immutable) and v1's image tree: python bake.py OUT_DIR. Writes OUT_DIR/data.json + img/*.

Everything the idle page shows is built here the way the server would build it: SQL over
the listener's plays, facts (refined labels), credits and bios. No LLM is involved."""
import json, re, sqlite3, sys, pathlib, random
from collections import Counter, defaultdict
from PIL import Image

sys.path.insert(0, "/mnt/data/lyrics-search")
from app.services.song_facts_service import get_song_facts_key  # noqa: E402

OUT = pathlib.Path(sys.argv[1]); (OUT / "img").mkdir(parents=True, exist_ok=True)
V1 = pathlib.Path("/mnt/data/lyrics-search/frontend")
db = sqlite3.connect("file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1", uri=True)
C = "acct_c2b5b12d55d341feb0940929e5a12c0d"
END = "2026-09-30"
random.seed(23)


def image(path, size, prefix):
    if not path:
        return None
    src = V1 / path.lstrip("/")
    if not src.exists():
        return None
    name = f"{prefix}-{src.stem}"
    dst = OUT / "img" / f"{name}.jpg"
    if not dst.exists():
        im = Image.open(src).convert("RGB")
        w, h = im.size; s = min(w, h)
        im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((size, size), Image.LANCZOS).save(dst, quality=84)
    return name


cover = lambda p: image(p, 320, "c")
plural = lambda n, a, b, c: a if n % 10 == 1 and n % 100 != 11 else b if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else c
photo = lambda p: image(p, 360, "p")

# ── the library and its plays ───────────────────────────────────────────────
tracks = {}
for tid, title, artist, slugs, primary, album, year, cov, prod, dur in db.execute(
        "select track_id,title,artist,artist_slugs,primary_artist_slug,album,year,cover_art_path,producer,duration from track_metadata where collection_name=?", (C,)):
    tracks[tid] = dict(id=tid, t=title, a=artist, slugs=json.loads(slugs or "[]"), p=primary, al=album, y=year, cov=cov, prod=prod, d=dur)
plays = Counter(); last = {}
for tid, at in db.execute("select track_id, played_at from playback_events where collection_name=? and skipped_early=0", (C,)):
    plays[tid] += 1; last[tid] = max(last.get(tid, ""), at)
names = dict(db.execute("select slug, name from artists"))
aphoto = dict(db.execute("select slug, thumb_path from artists where thumb_path is not null"))
by_artist = Counter(); artist_last = {}
for tid, n in plays.items():
    t = tracks.get(tid)
    if t:
        by_artist[t["p"]] += n; artist_last[t["p"]] = max(artist_last.get(t["p"], ""), last[tid])
top = [s for s, _ in by_artist.most_common(40) if s in names]

used = {}  # track id → compact track for the page


def tr(tid):
    t = tracks[tid]
    used[tid] = dict(id=tid, t=t["t"], a=t["a"], al=t["al"], y=t["y"], c=cover(t["cov"]), d=round(t["d"] or 0), n=plays[tid])
    return tid


def top_tracks(slug, k=12):
    ids = sorted((tid for tid, t in tracks.items() if t["p"] == slug or slug in t["slugs"]), key=lambda i: -plays[i])
    return [tr(i) for i in ids[:k]]


def artist_cover(slug):
    best = max((t for t in tracks.values() if t["p"] == slug and t["cov"]), key=lambda t: plays[t["id"]], default=None)
    return cover(best["cov"]) if best else None


def card_artist(slug):
    return dict(slug=slug, name=names[slug], photo=photo(aphoto.get(slug)), cover=artist_cover(slug), plays=by_artist[slug])


# ── facts by label, per song of the library ────────────────────────────────
song_key = {}
for tid, t in tracks.items():
    song_key.setdefault(get_song_facts_key(names.get(t["p"], t["a"]), t["t"]), []).append(tid)
song_facts = defaultdict(list)
for key, labels, text in db.execute("select scope_key, labels_json, text from refined_fact_items where lang='ru' and scope='song' and text is not null"):
    if key in song_key:
        for l in json.loads(labels or "[]"):
            song_facts[l].append((key, text))


def best_song(key):
    return max(song_key[key], key=lambda i: plays[i])


def song_fact_pool(label, k, maxlen=170, artists=None):
    seen, out = set(), []
    cand = sorted(song_facts[label], key=lambda kt: -sum(plays[i] for i in song_key[kt[0]]))
    for key, text in cand:
        if key in seen or len(text) > maxlen or sum(plays[i] for i in song_key[key]) < 2:
            continue
        a = tracks[best_song(key)]["p"]
        if artists is not None:
            if a in artists:
                continue
            artists.add(a)
        seen.add(key); out.append((tr(best_song(key)), text))
        if len(out) >= k:
            break
    return out


# ── the orbit: questions built per listener ─────────────────────────────────
orbit = []
a1, a2 = top[0], top[2]
orbit.append(dict(q=f"Хиты {names[a1]}", intent="playlist", why=f"{names[a1]} — твой артист №1", tracks=top_tracks(a1)))
names_known = []
for s in top[:30]:
    r = db.execute("select name_origin from artist_bios where artist_slug=? and lang='ru' and name_origin<>'' order by generated_at desc limit 1", (s,)).fetchone()
    if r:
        band = "назван" in r[0].lower()[:80]
        names_known.append((s, r[0], band))
for s, text, band in names_known[:3]:
    orbit.append(dict(q=f"Откуда {'название' if band else 'имя'} {names[s]}?", intent="general",
                      why=f"есть история имени · №{top.index(s) + 1} у тебя", answer=text, artist=card_artist(s)))
for tid, text in song_fact_pool("title_origin", 2, 400):
    t = tracks[tid]
    orbit.append(dict(q=f"Что значит название «{t['t']}»?", intent="general", why=f"{plays[tid]} прослушиваний · есть факт о названии", track=tid, answer=text))

# producers credited on songs of several artists
prod = defaultdict(lambda: [set(), []])
for tid, t in tracks.items():
    for name in re.split(r"\s*(?:,|;| & )\s*", t["prod"] or ""):
        if name and name.lower() != names.get(t["p"], "").lower():
            prod[name.strip()][0].add(t["p"]); prod[name.strip()][1].append(tid)
producers = sorted(prod.items(), key=lambda kv: (-len(kv[1][0]), -len(kv[1][1])))
p0 = producers[0]
orbit.append(dict(q=f"Песни с продюсером {p0[0]}", intent="playlist", why=f"{len(p0[1][1])} {plural(len(p0[1][1]), 'песня', 'песни', 'песен')} у {len(p0[1][0])} твоих артистов",
                  tracks=[tr(i) for i in sorted(p0[1][1], key=lambda i: -plays[i])[:15]]))
orbit.append(dict(q="Что-нибудь спокойное на вечер", intent="audio_search", why="сейчас вечер"))
orbit.append(dict(q="Песня, где поётся, что гравитация всегда выигрывает", intent="lyrics_search", why="поиск по строчке"))
fav = max(plays, key=lambda i: plays[i] if tracks.get(i, {}).get("p") != a1 else 0)
orbit.append(dict(q=f"Похожее по звуку на «{tracks[fav]['t']}»", intent="audio_search", why=f"{plays[fav]} прослушиваний за лето", track=tr(fav)))
for tid, text in song_fact_pool("placement", 1):
    orbit.append(dict(q=f"Где звучала «{tracks[tid]['t']}»?", intent="general", why="есть факт: кино, игры, реклама", track=tid, answer=text))

# ── the carousel: hooks built from data ─────────────────────────────────────
carousel = []
for name, (arts, tids) in producers[:4]:
    arts_sorted = sorted(arts, key=lambda s: -by_artist[s])
    carousel.append(dict(kind="producer", kicker="Продюсер", title=name, n=len(tids), m=len(arts),
                         line=", ".join(names.get(s, s) for s in arts_sorted[:3]) + (f" и ещё {len(arts) - 3}" if len(arts) > 3 else ""),
                         covers=[artist_cover(s) for s in arts_sorted[:4] if artist_cover(s)],
                         ask=f"Песни с продюсером {name}", intent="playlist",
                         tracks=[tr(i) for i in sorted(tids, key=lambda i: -plays[i])[:15]]))
guest = defaultdict(lambda: [set(), []])
for tid, t in tracks.items():
    for s in t["slugs"][1:]:
        if s != t["p"]:
            guest[s][0].add(t["p"]); guest[s][1].append(tid)
for s, (arts, tids) in sorted(guest.items(), key=lambda kv: -len(kv[1][0]))[:2]:
    if s in names:
        arts_sorted = sorted(arts, key=lambda x: -by_artist[x])
        carousel.append(dict(kind="guest", kicker="Гость", title=names[s], n=len(tids), m=len(arts), photo=photo(aphoto.get(s)),
                             line="на фитах у " + ", ".join(names.get(x, x) for x in arts_sorted[:3]),
                             covers=[artist_cover(x) for x in arts_sorted[:4] if artist_cover(x)],
                             ask=f"Песни, где появляется {names[s]}", intent="playlist", tracks=[tr(i) for i in tids[:15]]))
KICK = {"placement": "Звучала в кадре", "record": "Рекорд"}
seen_artists = set()
for label in ("placement", "record"):
    for tid, text in song_fact_pool(label, 3, 170, seen_artists):
        t = tracks[tid]
        carousel.append(dict(kind="story", kicker=KICK[label], title=t["t"], line=text, cover=used[tid]["c"], artist=t["a"],
                             ask=f"Расскажи историю «{t['t']}»", intent="general", track=tid))
for s, text, band in names_known[3:6]:
    a = card_artist(s)
    carousel.append(dict(kind="name", kicker="Происхождение названия" if band else "Происхождение имени", title=names[s], photo=a["photo"],
                         line=f"Откуда {'название' if band else 'имя'} {names[s]}?", ask=f"Откуда {'название' if band else 'имя'} {names[s]}?",
                         intent="general", answer=text))
albums = defaultdict(lambda: [0, None, None, None])
for tid, t in tracks.items():
    if t["al"] and t["y"]:
        k = (t["al"], t["p"]); albums[k][0] += plays[tid]; albums[k][1] = t["y"]; albums[k][2] = t["cov"] or albums[k][2]; albums[k][3] = t["a"]
for (al, slug), (n, y, cov, artist) in sorted(albums.items(), key=lambda kv: -kv[1][0]):
    if 2026 - int(y) in (10, 20, 25, 30, 40) and n >= 5 and sum(1 for c in carousel if c["kind"] == "year") < 2:
        carousel.append(dict(kind="year", kicker="Юбилей в этом году", title=al, years=2026 - int(y), artist=names.get(slug, artist), cover=cover(cov),
                             line=f"{2026 - int(y)} лет · {y}", ask=f"Расскажи историю альбома «{al}» {names.get(slug, artist)}", intent="general"))
for s in top[:40]:
    if artist_last.get(s, "9") < "2026-08-31" and by_artist[s] >= 25:
        carousel.append(dict(kind="forgotten", kicker="Давно не звучит", title=names[s], photo=photo(aphoto.get(s)),
                             line=f"{by_artist[s]} прослушиваний, последнее — {artist_last[s][8:10]}.{artist_last[s][5:7]}",
                             ask=f"Лучшее {names[s]}", intent="playlist", tracks=top_tracks(s)))
        break

# the sky: questions asked before (examples for the mock)
sky = [("Почему Kanye назвал альбом «Yeezus»?", "general"), ("Песни как «Do I Wanna Know?», но быстрее", "audio_search"),
       ("Что сэмплирует «Stronger»?", "general"), ("Подборка в дорогу на машине", "playlist"), ("Песня со строчкой про холодное сердце", "lyrics_search"),
       ("Кто такая Ty Dolla $ign?", "general"), ("Грустное без слов", "audio_search"), ("Хиты 2007 года из моей библиотеки", "playlist"),
       ("Где поётся «we are young»?", "lyrics_search"), ("Что значит «Mr. Brightside»?", "general"), ("Плейлист под бег 170 bpm", "playlist"),
       ("Похожее на Royal Blood", "audio_search"), ("История группы Nothing But Thieves", "general"), ("Песня про ночной Лос-Анджелес", "lyrics_search"),
       ("Что продюсировал Rick Rubin?", "playlist"), ("Почему The Weeknd пишет weeknd без e?", "general"), ("Электроника для работы", "audio_search"),
       ("Кто поёт припев в «Numb/Encore»?", "general"), ("Песни с саксофоном", "audio_search"), ("Подборка на вечер пятницы", "playlist"),
       ("Строчка «is this the real life»", "lyrics_search"), ("Сколько Грэмми у Eminem?", "general"), ("Что-то как Two Door Cinema Club", "audio_search")]
answers = {}
if len(sys.argv) > 2:
    by_title = {}
    for tid, t in tracks.items():
        by_title.setdefault((t["t"].lower(), names.get(t["p"], t["a"]).lower()), tid); by_title.setdefault((t["t"].lower(), ""), tid)
    def v1id(x):
        if x.get("track_id") in tracks:
            return tr(x["track_id"])
        key = (str(x.get("title", "")).lower(), str(x.get("artist", "")).split(" & ")[0].split(",")[0].lower())
        tid = by_title.get(key) or by_title.get((key[0], ""))
        return tr(tid) if tid else None
    for t in json.loads(pathlib.Path(sys.argv[2]).read_text())["turns"]:
        r = t["result"] or {}
        a = dict(q=t["message"], intent=r.get("intent"), seconds=t["seconds"], human=r.get("human"))
        if r.get("playlist"):
            a["title"] = r["playlist"].get("title"); a["tracks"] = [i for i in (v1id(x) for x in r["playlist"]["tracks"]) if i]
        if r.get("search"):
            a["hits"] = [dict(id=v1id({"track_id": h["track"].get("track_id"), "title": h["track"]["title"], "artist": h["track"]["artist"]}),
                              line=h.get("matched_line"), lyrics=h.get("lyrics"), score=h.get("score")) for h in r["search"]["hits"]]
            a["message"] = r["search"].get("message")
        if r.get("answer"):
            a["text"] = r["answer"].get("answer"); a["follow"] = r["answer"].get("follow_ups"); a["subject"] = r["answer"].get("subject")
        answers[t["key"]] = a
data = dict(answers=answers, top=[card_artist(s) for s in top[:12]], orbit=orbit, carousel=carousel, sky=[dict(q=q, intent=i) for q, i in sky],
            producers=[dict(name=n, n=len(t), m=len(a)) for n, (a, t) in producers[:8]], tracks=used)
(OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
print(len(orbit), "orbit;", len(carousel), "cards;", len(used), "tracks;", len(list((OUT / 'img').iterdir())), "images")
for o in orbit: print(" ·", o["intent"], o["q"], "—", o["why"])
for c in carousel: print(" ▪", c["kind"], c["title"], "—", c["line"][:90])
