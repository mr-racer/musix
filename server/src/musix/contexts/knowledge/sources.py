"""The outbound knowledge sources, each inside its shared budget and breaker
(`infra/ratelimit`): songfacts.com (song and artist pages), Genius (description,
line annotations, producer and label credits), TheAudioDB with Deezer as the image
fallback, MusicBrainz (sample-link verification, 1 req/s as v1).

The parsers are v1's, copied (`song_facts_service`, `artist_facts_service`,
`audiodb_service`, `genius_service`). What changed is only the transport: httpx
through `guard` instead of requests/curl_cffi with sleeps. Every fetcher returns
`(result, definitive)`: a 404 is an answer worth remembering in `source_fetch_log`, an
unreachable site is not (v1's rule: one bad night upstream must not bury a page)."""

from __future__ import annotations

import asyncio
import json
import re
from html import unescape
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library import artist_split
from musix.contexts.library.slug import slugify, song_slug
from musix.errors import Unavailable
from musix.infra.ratelimit import Source, guard
from musix.knowledge import genius as G
from musix.knowledge.facts_v2 import sample_links as sl

SM = async_sessionmaker[AsyncSession]
SONGFACTS = Source("songfacts", rate=1.0, burst=2)
GENIUS = Source("genius", rate=4.0, burst=4)  # v1: batches of 4 referents, 0.3 s apart
AUDIODB = Source("theaudiodb", rate=2.0, burst=2)
DEEZER = Source("deezer", rate=5.0, burst=5)
IMAGES = Source("artist-images", rate=4.0, burst=4)
MUSICBRAINZ = Source("musicbrainz", rate=1.0, burst=1)  # their limit is per IP
ITUNES = Source("itunes", rate=0.3, burst=2)  # the search API allows ~20 calls a minute
APPLE_MUSIC = Source("apple-music", rate=1.0, burst=2)
UA = "MusiX/2.0 ( https://musixai.ru )"  # MusicBrainz answers 503 to a bare agent
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"


def client(proxy: str | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=5.0),
        headers={"User-Agent": BROWSER},
        follow_redirects=True,
        proxy=proxy,
        trust_env=False,  # only an explicit MUSIX_PROXY_URL is used (v1's proxy contract)
    )


async def _get(
    sm: SM, src: Source, http: httpx.AsyncClient, url: str, **kw: Any
) -> tuple[httpx.Response | None, bool]:
    """(response, definitive). 4xx is definitive and returns no response; network errors
    and 5xx raise Unavailable through the breaker, so the queue retries later."""

    async def call() -> httpx.Response:
        r = await http.get(url, **kw)
        if r.status_code >= 500 or r.status_code == 429:
            raise Unavailable(f"{src.name}: HTTP {r.status_code}", source=src.name)
        return r

    try:
        r = await guard(sm, src, call)
    except httpx.HTTPError as e:
        raise Unavailable(f"{src.name}: {type(e).__name__}", source=src.name) from e
    if r.status_code >= 400:
        return None, True
    return r, True


# ── songfacts.com (v1 song_facts_service / artist_facts_service) ─────────────


def artist_query(artist: str) -> str:
    """v1 `_artist_query`: songfacts lists a song under its PRIMARY performer."""
    return artist_split.primary_artist(artist) or artist


def _parse_list(html_string: str, css_class: str) -> list[str]:
    """v1 `_parse_song_facts` / `_parse_facts` — the two differ only in the list class."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_string, "html.parser")
    container = soup.find("ul", class_=css_class)
    if not container:
        return []
    facts: list[str] = []
    for li in container.find_all("li"):
        inner_div = li.find("div", class_="inner")
        if inner_div:
            raw = inner_div.get_text(separator=" ", strip=True)
            cleaned = re.sub(r"\s+", " ", raw).strip()
            cleaned = unescape(cleaned)
            if cleaned:
                facts.append(cleaned)
    return facts


async def songfacts_song(
    sm: SM, http: httpx.AsyncClient, artist: str, title: str
) -> tuple[list[str], bool]:
    url = f"https://www.songfacts.com/facts/{song_slug(artist_query(artist))}/{song_slug(title)}"
    r, definitive = await _get(sm, SONGFACTS, http, url)
    return (_parse_list(r.text, "songfacts-results") if r else []), definitive


async def songfacts_artist(sm: SM, http: httpx.AsyncClient, artist: str) -> tuple[list[str], bool]:
    r, definitive = await _get(
        sm, SONGFACTS, http, f"https://www.songfacts.com/facts/{slugify(artist)}"
    )
    return (_parse_list(r.text, "artistfacts-results") if r else []), definitive


# ── Genius (v1 genius_service / genius_facts_service) ────────────────────────


async def genius_song(
    sm: SM, http: httpx.AsyncClient, artist: str, title: str
) -> tuple[G.GeniusSongData | None, bool]:
    url = G.build_genius_url(artist, title)
    r, definitive = await _get(sm, GENIUS, http, url)
    if r is None:
        return None, definitive
    data = G.parse_page(r.text)
    try:
        refs = G.referent_urls(data)
    except (KeyError, TypeError):
        refs = []

    # every annotation at once filled the shared pool whenever the proxy stalled (PoolTimeout
    # for every other source); 8 in flight is still twice the bucket's 4/s
    gate = asyncio.Semaphore(8)

    async def one(rid: str, link: str) -> tuple[str, str] | None:
        try:
            async with gate:
                rr, _ = await _get(sm, GENIUS, http, link)
        except Unavailable:
            return None  # v1: a referent that fails is skipped, the song is not
        return G.parse_referent(rr.text, rid) if rr else None

    annotations = [a for a in await asyncio.gather(*(one(rid, u) for rid, u in refs)) if a]
    try:
        return G.song_data(url, r.text, data, annotations), True
    except G.GeniusParseError:
        return None, True


async def genius_page(
    sm: SM, http: httpx.AsyncClient, artist: str, title: str
) -> tuple[G.GeniusSongData | None, bool]:
    """The song page without its annotations: what `genius_song` reads in one request
    (samples, credits, tags, producers, label, description)."""
    url = G.build_genius_url(artist, title)
    r, definitive = await _get(sm, GENIUS, http, url)
    if r is None:
        return None, definitive
    try:
        return G.song_data(url, r.text, G.parse_page(r.text), []), True
    except G.GeniusParseError:
        return None, True


# ── TheAudioDB + Deezer (v1 audiodb_service) ─────────────────────────────────

_FEAT_RE = re.compile(r"\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$", re.IGNORECASE)
AUDIODB_BASE_URL = "https://www.theaudiodb.com/api/v1/json/123/search.php"
DEEZER_SEARCH_URL = "https://api.deezer.com/search/artist"


def canonical_artist_name(artist: str) -> str:
    """'Dua Lipa feat. Angele' -> 'Dua Lipa'."""
    return _FEAT_RE.sub("", artist_split.normalize_artist_name(artist)).strip()


def audiodb_slug(canonical_artist: str) -> str:
    """v1 `_audiodb_slug`: lowercase, dashes normalized, punctuation dropped, '+'-joined."""
    s = canonical_artist.lower()
    s = re.sub(r"[‐‑‒–—―−]", "-", s)
    s = re.sub(r"[,.'`\"!?\\/&()+]", "", s)
    s = re.sub(r"[\s\-_]+", " ", s).strip()
    return "+".join(s.split())


async def audiodb(
    sm: SM, http: httpx.AsyncClient, canonical: str
) -> tuple[dict[str, Any] | None, bool]:
    """The AudioDB artist record, or None for «unknown artist» (definitive)."""
    r, definitive = await _get(sm, AUDIODB, http, f"{AUDIODB_BASE_URL}?s={audiodb_slug(canonical)}")
    if r is None:
        return None, definitive
    try:
        artists = (r.json() or {}).get("artists") or []
    except ValueError:
        return None, False
    return (artists[0] if artists else None), True


async def deezer_picture(sm: SM, http: httpx.AsyncClient, canonical: str) -> str | None:
    """v1: the FIRST result's name must match the canonical name — Deezer search is
    fuzzy, and 'kanye+west' could return a tribute act."""
    r, _ = await _get(sm, DEEZER, http, f"{DEEZER_SEARCH_URL}?q={audiodb_slug(canonical)}")
    if r is None:
        return None
    try:
        results = (r.json() or {}).get("data") or []
    except ValueError:
        return None
    if (
        not results
        or (results[0].get("name") or "").strip().casefold() != canonical.strip().casefold()
    ):
        return None
    pic = results[0].get("picture_xl")
    return str(pic) if pic else None


async def download(sm: SM, http: httpx.AsyncClient, url: str | None) -> bytes | None:
    if not url:
        return None
    try:
        r, _ = await _get(sm, IMAGES, http, url)
    except Unavailable:
        return None  # best effort, as v1
    return r.content if r is not None and r.content else None


# ── Apple Music (the artist page's editorial photos) ─────────────────────────

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
_SERVER_DATA = re.compile(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>', re.S)


def _art(v: Any) -> dict[str, Any] | None:
    a = v.get("dictionary") if isinstance(v, dict) else None
    return (
        a if isinstance(a, dict) and isinstance(a.get("url"), str) and "{w}" in a["url"] else None
    )


def _sized(a: dict[str, Any], w: int, h: int, ext: str) -> str:
    """Apple's artwork template `…/{w}x{h}{c}.{f}`: `bb` is the plain (uncropped) image."""
    return str(a["url"]).split("{w}")[0] + f"{w}x{h}bb.{ext}"


def apple_images(html_text: str) -> dict[str, Any] | None:
    """The artist header of a music.apple.com artist page (its serialized-server-data):
    the square `artwork`, the wide 2:1 `wideArtwork` big artists have, the transparent
    `artistLogo` and the page's `bgColor`. None when the page has no such header."""
    m = _SERVER_DATA.search(html_text)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
        item = data["data"][0]["data"]["sections"][0]["items"][0]
    except (ValueError, KeyError, IndexError, TypeError):
        return None
    out: dict[str, Any] = {}
    sq, wide, logo = (
        _art(item.get("artwork")),
        _art(item.get("wideArtwork")),
        _art(item.get("artistLogo")),
    )
    if sq:
        side = min(2400, int(sq.get("width") or 2400), int(sq.get("height") or 2400))
        out["photo"] = _sized(sq, side, side, "jpg")
    if wide and (wide.get("width") or 0) > (wide.get("height") or 0):
        w, h = int(wide["width"]), int(wide["height"])
        tw = min(2400, w)
        out["wide"] = _sized(wide, tw, round(tw * h / w), "jpg")
    if logo and logo.get("width") and logo.get("height"):
        w, h = int(logo["width"]), int(logo["height"])
        tw = min(1440, w)
        out["logo"] = _sized(logo, tw, round(tw * h / w), "png")
    bg = next((a.get("bgColor") for a in (wide, sq) if a and a.get("bgColor")), None)
    if isinstance(bg, str) and re.fullmatch(r"[0-9a-fA-F]{6}", bg):
        out["bg"] = "#" + bg.lower()
    return out or None


async def apple_artist(
    sm: SM, http: httpx.AsyncClient, canonical: str
) -> tuple[dict[str, Any] | None, bool]:
    """(images, definitive): the iTunes search finds the artist's page by its exact name
    (folded; the search is fuzzy and a tribute act or a duo comes second), the page gives
    the editorial images. No match is a definitive miss."""
    from musix.contexts.search.normalize import fold

    r, definitive = await _get(
        sm,
        ITUNES,
        http,
        ITUNES_SEARCH_URL,
        params={"term": canonical, "entity": "musicArtist", "limit": 5},
    )
    if r is None:
        return None, definitive
    try:
        results = (r.json() or {}).get("results") or []
    except ValueError:
        return None, False
    want = fold(canonical)
    hit = next((x for x in results if fold(str(x.get("artistName") or "")) == want), None)
    link = str((hit or {}).get("artistLinkUrl") or "").split("?")[0]
    if not link.startswith("https://music.apple.com/"):
        return None, True
    page, definitive = await _get(sm, APPLE_MUSIC, http, link)
    if page is None:
        return None, definitive
    got = apple_images(page.text)
    if got is not None:
        got["url"] = link
    return got, True


# ── MusicBrainz: an album's first release ────────────────────────────────────

# what tags add to a reissue's title: «(Deluxe Edition)», «[Tour Edition]», «(40th Anniversary)»
_EDITION = re.compile(
    r"\s*[(\[][^)\]]*(?:edition|deluxe|version|remaster|anniversary|expanded|tour|bonus|"
    r"explicit|special|super)[^)\]]*[)\]]\s*$",
    re.IGNORECASE,
)
_BAD_SECONDARY = {"Compilation", "Live", "Remix", "Demo", "DJ-mix", "Interview", "Spokenword"}


def album_base_title(title: str) -> str:
    t = title
    while (m := _EDITION.search(t)) is not None:
        t = t[: m.start()]
    return re.sub(r"\s*[-–]\s*(?:EP|Single)$", "", t).strip() or title


async def musicbrainz_first_year(
    sm: SM, http: httpx.AsyncClient, artist: str, title: str
) -> tuple[int | None, bool]:
    """The earliest first-release year of the release groups called exactly `title` (its
    edition words dropped) by `artist` that are albums or EPs and not compilations, live,
    remixes or demos. (None, True) = MusicBrainz has no such album."""
    from musix.contexts.search.normalize import fold

    base = album_base_title(title)
    q = f'releasegroup:"{_lucene(base)}" AND artist:"{_lucene(artist)}"'
    r, definitive = await _get(
        sm,
        MUSICBRAINZ,
        http,
        "https://musicbrainz.org/ws/2/release-group",
        params={"query": q, "limit": 10, "fmt": "json"},
        headers={"User-Agent": UA},
    )
    if r is None:
        return None, definitive
    try:
        groups = (r.json() or {}).get("release-groups") or []
    except ValueError:
        return None, False
    want_t, want_a = fold(base), fold(artist)
    years: list[int] = []
    for g in groups:
        credit = " ".join(
            (c.get("name") or c.get("artist", {}).get("name", "")) if isinstance(c, dict) else ""
            for c in g.get("artist-credit") or []
        )
        date = str(g.get("first-release-date") or "")
        if (
            fold(str(g.get("title") or "")) == want_t
            and want_a in fold(credit)
            and g.get("primary-type") in ("Album", "EP")
            and not _BAD_SECONDARY & set(g.get("secondary-types") or [])
            and re.match(r"\d{4}", date)
        ):
            years.append(int(date[:4]))
    return (min(years) if years else None), True


# ── MusicBrainz (v1 facts_v2.sample_links.MusicBrainz.verify) ────────────────


def _lucene(s: str) -> str:
    return re.sub(r'([+\-&|!(){}\[\]^"~*?:\\/])', r"\\\1", s)


async def musicbrainz_verify(
    sm: SM, http: httpx.AsyncClient, artist: str, title: str
) -> dict[str, Any]:
    """One recording search, scored exactly as v1 (`sample_links._side_matches` and
    `_mb_verified`). A 503 raises Unavailable: the queue retries the task later,
    which replaces v1's in-place sleep-and-retry."""
    q = f"recording:({_lucene(title)}) AND artist:({_lucene(artist)})"
    r, _ = await _get(
        sm,
        MUSICBRAINZ,
        http,
        "https://musicbrainz.org/ws/2/recording",
        params={"query": q, "limit": 3, "fmt": "json"},
        headers={"User-Agent": UA},
    )
    if r is None:
        return {"checked": False, "error": "4xx"}
    best: dict[str, Any] | None = None
    for rec in (r.json() or {}).get("recordings") or []:
        credit = rec.get("artist-credit") or []
        mb_artist = " ".join(
            (c.get("artist", {}).get("name", "") if isinstance(c, dict) else str(c)) for c in credit
        ).strip()
        cand = {
            "checked": True,
            "score": int(rec.get("score") or 0),
            "artist_ratio": round(sl._side_matches(artist, mb_artist), 2),
            "title_ratio": round(sl._side_matches(title, rec.get("title") or ""), 2),
            "mb_artist": mb_artist,
            "mb_title": rec.get("title"),
            "mbid": rec.get("id"),
        }
        rank = (sl._mb_verified(cand), cand["artist_ratio"] + cand["title_ratio"], cand["score"])
        if best is None or rank > (
            sl._mb_verified(best),
            best["artist_ratio"] + best["title_ratio"],
            best["score"],
        ):
            best = cand
    out = best or {"checked": True, "score": 0, "artist_ratio": 0, "title_ratio": 0}
    out["verified"] = sl._mb_verified(out)
    return out
