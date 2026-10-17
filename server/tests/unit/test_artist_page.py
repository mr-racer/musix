"""The artist page «Кадр» (2026-10-17): Apple Music's artist header, an album's first
release year from MusicBrainz, the artist quiz's rounds."""

import json
import random

import httpx
import pytest

from musix.contexts.knowledge import sources as src
from musix.quiz.context import RoundContext
from musix.quiz.errors import NoRoundAvailable
from musix.quiz.modes import artist_snippet


def _page(item: dict) -> str:
    data = {"data": [{"data": {"sections": [{"items": [item]}]}}]}
    tag = '<script type="application/json" id="serialized-server-data">'
    return f"<html>{tag}{json.dumps(data)}</script></html>"


def _art(w: int, h: int, bg: str | None = None) -> dict:
    d = {
        "url": "https://is1-ssl.mzstatic.com/image/thumb/X/a.png/{w}x{h}{c}.{f}",
        "width": w,
        "height": h,
    }
    return {"dictionary": {**d, **({"bgColor": bg} if bg else {})}}


def test_apple_header_gives_square_wide_logo_and_colour() -> None:
    got = src.apple_images(
        _page(
            {
                "artwork": _art(3000, 3000, "3c4022"),
                "wideArtwork": _art(4320, 2160, "040404"),
                "artistLogo": _art(2000, 400),
            }
        )
    )
    assert got is not None
    assert got["photo"].endswith("/2400x2400bb.jpg")
    assert got["wide"].endswith("/2400x1200bb.jpg")
    assert got["logo"].endswith("/1440x288bb.png")
    assert got["bg"] == "#040404"  # the wide frame's colour wins: it is what the hero shows


def test_a_square_wide_artwork_is_not_a_wide_frame() -> None:
    got = src.apple_images(_page({"artwork": _art(1200, 1200), "wideArtwork": _art(1200, 1200)}))
    assert got == {"photo": "https://is1-ssl.mzstatic.com/image/thumb/X/a.png/1200x1200bb.jpg"}
    assert src.apple_images("<html>no header</html>") is None


@pytest.mark.parametrize(
    ("title", "base"),
    [
        ("Late Registration (Australian Tour Edition)", "Late Registration"),
        ("The Eminem Show (Expanded Edition)", "The Eminem Show"),
        ("Donda (Deluxe)", "Donda"),
        ("Thriller (40th Anniversary) [Remastered]", "Thriller"),
        ("Vultures 1", "Vultures 1"),
    ],
)
def test_album_base_title_drops_edition_words(title: str, base: str) -> None:
    assert src.album_base_title(title) == base


async def test_first_year_skips_compilations_and_other_titles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    groups = [
        {
            "title": "Thriller",
            "first-release-date": "1982-11-30",
            "primary-type": "Album",
            "artist-credit": [{"name": "Michael Jackson"}],
        },
        {
            "title": "Thriller / Off the Wall",
            "first-release-date": "1980",
            "primary-type": "Album",
            "artist-credit": [{"name": "Michael Jackson"}],
        },
        {
            "title": "Thriller",
            "first-release-date": "1979",
            "primary-type": "Album",
            "secondary-types": ["Compilation"],
            "artist-credit": [{"name": "Michael Jackson"}],
        },
        {
            "title": "Thriller",
            "first-release-date": "1975",
            "primary-type": "Album",
            "artist-credit": [{"name": "Someone Else"}],
        },
    ]

    async def fake_get(sm, s, http, url, **kw):  # type: ignore[no-untyped-def]
        return httpx.Response(200, json={"release-groups": groups}), True

    monkeypatch.setattr(src, "_get", fake_get)
    year, definitive = await src.musicbrainz_first_year(
        None, None, "Michael Jackson", "Thriller (40th Anniversary)"
    )  # type: ignore[arg-type]
    assert (year, definitive) == (1982, True)


def _ctx(n: int, artist: str = "a1") -> RoundContext:
    tracks = [
        {
            "track_id": f"t{i}",
            "title": f"Song {i}",
            "artist": "X",
            "primary_artist_id": artist,
            "duration": 200.0,
        }
        for i in range(n)
    ] + [
        {
            "track_id": "o1",
            "title": "Other",
            "artist": "Y",
            "primary_artist_id": "a2",
            "duration": 200.0,
        }
    ]
    return RoundContext(
        collection_name="c",
        tracks=tracks,
        plays={"t0": 30},
        last_played={},
        percentiles={},
        skill={},
        rng=random.Random(4),
        artist_id=artist,
    )


def test_artist_round_offers_four_songs_of_that_artist() -> None:
    ctx = _ctx(6)
    spec = artist_snippet.build(ctx, snippet_sec=3)
    assert len(spec.options) == 4
    assert {o["track_id"] for o in spec.options} <= {f"t{i}" for i in range(6)}
    assert spec.track_id in {o["track_id"] for o in spec.options}
    assert artist_snippet.pool_size(ctx) == 6


def test_artist_round_needs_four_songs() -> None:
    with pytest.raises(NoRoundAvailable):
        artist_snippet.build(_ctx(3), snippet_sec=3)
    assert artist_snippet.pool_size(RoundContext("c", [], {}, {}, {}, {})) == 0
