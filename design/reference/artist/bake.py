"""Bake the artist mock's data from the frozen v1 snapshot of 2026-10-01 (read-only, immutable)
and v1's image tree: python bake.py OUT_DIR. Writes OUT_DIR/data.json and OUT_DIR/img/*."""
import json, re, sqlite3, sys, pathlib
from collections import Counter, defaultdict
from PIL import Image, ImageFilter, ImageEnhance

OUT = pathlib.Path(sys.argv[1]); (OUT / "img").mkdir(parents=True, exist_ok=True)
V1 = pathlib.Path("/mnt/data/lyrics-search/frontend")
db = sqlite3.connect("file:/mnt/data/musix-snapshots/2026-10-01/metadata.db?mode=ro&immutable=1", uri=True)
C = "acct_c2b5b12d55d341feb0940929e5a12c0d"
SLUGS = ["kanye-west", "eminem", "lady-gaga", "arctic-monkeys", "the-weeknd", "maroon-5", "michael-jackson", "nothing-but-thieves"]


def vibrant(im: Image.Image) -> str:
    """The most saturated of the image's common colours (stands in for the server palette)."""
    small = im.convert("RGB").resize((64, 64))
    q = small.quantize(12, method=Image.Quantize.MEDIANCUT).convert("RGB")
    best, score = (200, 160, 90), -1.0
    for n, (r, g, b) in q.getcolors(4096) or []:
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / (mx or 1)
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        s = sat * (0.25 + min(lum, 0.7)) * (n ** 0.35)
        if 0.12 < lum < 0.85 and s > score:
            best, score = (r, g, b), s
    return "#%02x%02x%02x" % best


def backdrop(im: Image.Image, name: str) -> None:
    """The player's backdrop recipe, roughly: 192 px, blur 4.6, saturation x1.4, highlights tamed."""
    b = im.convert("RGB").resize((192, 192), Image.LANCZOS).filter(ImageFilter.GaussianBlur(4.6))
    b = ImageEnhance.Color(b).enhance(1.4)
    px = b.load()
    for y in range(192):
        for x in range(192):
            r, g, bb = px[x, y]
            l = (0.2126 * r + 0.7152 * g + 0.0722 * bb) / 255
            if l > 0.30:
                k = (0.30 + (l - 0.30) * 0.18) / l
                px[x, y] = (int(r * k), int(g * k), int(bb * k))
    b.save(OUT / "img" / f"{name}-bg.jpg", quality=86)


def cover(path: str | None) -> str | None:
    if not path:
        return None
    src = V1 / path.lstrip("/")
    if not src.exists():
        return None
    name = "c-" + src.stem
    dst = OUT / "img" / f"{name}.jpg"
    im = Image.open(src).convert("RGB")
    if not dst.exists():
        im.resize((320, 320), Image.LANCZOS).save(dst, quality=84)
    return name


# library-wide: Grammy wins of every artist the account has, plays per artist
lib_slugs = [r[0] for r in db.execute("select distinct primary_artist_slug from track_metadata where collection_name=?", (C,))]
plays_by_artist = Counter(dict(db.execute("""select t.primary_artist_slug, count(*) from playback_events pe
  join track_metadata t on t.track_id=pe.track_id and t.collection_name=pe.collection_name
  where pe.collection_name=? and pe.skipped_early=0 group by 1""", (C,)).fetchall()))
grammy = {}
for s in lib_slugs:
    r = db.execute("select grammy_wins, grammy_nominations from artist_bios where artist_slug=? and lang='ru' order by generated_at desc limit 1", (s,)).fetchone()
    if r and r[0]:
        name = db.execute("select name from artists where slug=? limit 1", (s,)).fetchone()
        grammy[s] = {"wins": r[0], "noms": r[1], "name": name[0] if name else s}
ranked_plays = [s for s, _ in plays_by_artist.most_common()]

out = {"artists": [], "grammyLib": sorted(grammy.values(), key=lambda g: -g["wins"]), "libArtists": len(lib_slugs)}
for slug in SLUGS:
    name, cc, place, label, mood, cut, thumb, adb_bio = db.execute(
        "select name,country_code,country,label,mood,cutout_path,thumb_path,audiodb_bio from artists where slug=? limit 1", (slug,)).fetchone()
    bio = db.execute("""select bio_text, grammy_wins, grammy_nominations, formed_year, formed_place, name_origin, status, active_from, active_to
        from artist_bios where artist_slug=? and lang='ru' order by generated_at desc limit 1""", (slug,)).fetchone()
    a = {"slug": slug, "name": name, "cc": cc, "place": place, "label": label, "mood": mood}
    if bio:
        a.update(bio=bio[0], grammyWins=bio[1], grammyNoms=bio[2], formedYear=bio[3], formedPlace=bio[4], nameOrigin=bio[5], status=bio[6], activeFrom=bio[7], activeTo=bio[8])
    if thumb:
        im = Image.open(V1 / thumb.lstrip("/")).convert("RGB")
        im.save(OUT / "img" / f"{slug}-photo.jpg", quality=86)
        backdrop(im, slug)
        a["photo"] = f"{slug}-photo"; a["tint"] = vibrant(im)
    if cut:
        im = Image.open(V1 / cut.lstrip("/")).convert("RGBA")
        bbox = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
        im.save(OUT / "img" / f"{slug}-cut.png", optimize=True)
        a["cut"] = f"{slug}-cut"; a["cutSize"] = im.size; a["cutBox"] = bbox  # x0 y0 x1 y1 of the opaque figure
    rows = db.execute("""select t.track_id, t.title, t.album, t.year, t.cover_art_path, t.genre, t.duration,
        (select count(*) from playback_events pe where pe.collection_name=t.collection_name and pe.track_id=t.track_id and pe.skipped_early=0) as plays,
        (select min(played_at) from playback_events pe where pe.collection_name=t.collection_name and pe.track_id=t.track_id) as first
        from track_metadata t where t.collection_name=? and t.primary_artist_slug=?""", (C, slug)).fetchall()
    albums = defaultdict(lambda: {"n": 0, "heard": 0, "plays": 0, "years": [], "cover": None})
    for tid, title, album, year, cov, genre, dur, plays, first in rows:
        al = albums[album or "—"]
        al["n"] += 1; al["heard"] += plays > 0; al["plays"] += plays
        if year: al["years"].append(year)
        al["cover"] = al["cover"] or cov
    a["albums"] = sorted(({"title": k, "year": min(v["years"]) if v["years"] else None, "n": v["n"], "heard": v["heard"], "plays": v["plays"], "cover": cover(v["cover"])}
                          for k, v in albums.items() if v["n"] >= 3), key=lambda x: (x["year"] or 9999, x["title"]))
    top = sorted(rows, key=lambda r: -r[7])[:8]
    a["top"] = [{"title": r[1], "album": r[2], "plays": r[7], "dur": r[6], "cover": cover(r[4])} for r in top]
    a["tracks"] = len(rows); a["plays"] = sum(r[7] for r in rows)
    firsts = [r[8] for r in rows if r[8]]
    a["since"] = min(firsts) if firsts else None
    a["rank"] = ranked_plays.index(slug) + 1 if slug in ranked_plays else None
    a["genre"] = Counter(r[5] for r in rows if r[5]).most_common(1)[0][0] if any(r[5] for r in rows) else None
    # who else is on this artist's songs and in the library (feats both ways)
    co = Counter()
    for (arts,) in db.execute("select artists from track_metadata where collection_name=? and (primary_artist_slug=? or artist_slugs like ?)", (C, slug, f'%"{slug}"%')):
        for n in json.loads(arts or "[]"):
            if n != name:
                co[n] += 1
    a["with"] = [{"name": n, "n": k} for n, k in co.most_common(6)]
    a["facts"] = [r[0] for r in db.execute("select fact from artist_facts where artist_slug=? order by id limit 6", (slug,))]
    out["artists"].append(a)
    print(slug, len(a["albums"]), "albums", a["tracks"], "tracks", a.get("grammyWins"), "wins", "cut" in a, "rank", a["rank"])

json.dump(out, open(OUT / "data.json", "w"), ensure_ascii=False, indent=1)
print("grammy in library:", len(grammy), sum(g["wins"] for g in grammy.values()), "wins")
