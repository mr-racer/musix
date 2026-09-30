"""«Почему этот трек» (stream spec §7): built from what actually happened — the sources
that proposed the track, the pool it filled, the genre move, and the ranker's top feature
contributions (`pred_contrib`, for the chosen track only). Never an LLM, so it is always
true and costs nothing. A `similar_to` reason is only given when the audio source really
proposed the track (v1's «похоже на» could claim a similarity that did not drive the
choice)."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from musix.recsys.features import FEATURES

# which feature contributions a listener can read, and how
PLAIN: dict[str, tuple[str, str]] = {
    "a_days_since": (
        "давно не было этого исполнителя",
        "you haven't heard this artist for a while",
    ),
    "a_full_rate": (
        "ты почти всегда дослушиваешь этого исполнителя",
        "you nearly always finish this artist",
    ),
    "t_full_rate": ("ты обычно дослушиваешь этот трек", "you usually finish this track"),
    "t_days_since": ("давно не звучал", "not played for a while"),
    "t_days_in_lib": ("недавно в библиотеке", "recently added"),
    "a_plays": ("один из твоих частых исполнителей", "one of your frequent artists"),
    "g_long_share": ("жанр, который ты слушаешь чаще всего", "a genre you listen to most"),
    "energy_dev": ("энергия под то, что сейчас звучит", "the energy fits what's playing"),
    "a_in_sess": ("исполнитель из этой сессии", "an artist from this session"),
    "t_fire": ("ты отмечал его огоньком", "you gave it a fire"),
}
MONTHS_RU = (
    "январе",
    "феврале",
    "марте",
    "апреле",
    "мае",
    "июне",
    "июле",
    "августе",
    "сентябре",
    "октябре",
    "ноябре",
    "декабре",
)


@dataclass
class Reason:
    kind: str
    text: str
    refs: dict[str, Any] = field(default_factory=dict)
    details: list[str] = field(default_factory=list)


def _top(contrib: np.ndarray | None, lang: str, k: int = 3) -> list[tuple[str, str]]:
    """The k features that pushed the score up the most, as (feature, plain text)."""
    if contrib is None:
        return []
    order = np.argsort(-contrib[: len(FEATURES)])
    out = []
    for i in order:
        f = FEATURES[i]
        if contrib[i] <= 0:
            break
        if f in PLAIN:
            out.append((f, PLAIN[f][0 if lang == "ru" else 1]))
        if len(out) == k:
            break
    return out


def build(
    *,
    lang: str,
    pool: str,
    sources: set[str],
    explore: bool,
    trigger: str | None,
    from_genre: str | None,
    to_genre: str | None,
    sound: str | None,
    artist: str | None,
    ref_track: str | None,
    last_played: dt.datetime | None,
    contrib: np.ndarray | None,
) -> Reason:
    ru = lang == "ru"
    top = _top(contrib, lang)
    details = [t for _, t in top]
    feats = {f for f, _ in top}
    if explore:
        return Reason(
            "explore",
            "Пробуем: вне твоего обычного" if ru else "Trying something outside your usual",
            details=details,
        )
    if trigger and to_genre:
        text = (
            f"Мост: из {from_genre} в {to_genre}"
            if ru
            else f"Bridge: from {from_genre} to {to_genre}"
        )
        return Reason("bridge", text, {"from": from_genre, "to": to_genre}, details)
    if pool.endswith("rediscover") and last_played:
        when = f"в {MONTHS_RU[last_played.month - 1]}" if ru else last_played.strftime("in %B")
        return Reason(
            "rediscover",
            f"Давно не слушал — последний раз {when}"
            if ru
            else f"Not heard for a while — last {when}",
            {"lastPlayedAt": last_played.isoformat()},
            details,
        )
    if pool.endswith("unplayed"):
        return Reason("new_for_you", "Новое для тебя" if ru else "New to you", details=details)
    if "session_artist" in sources and artist:
        return Reason(
            "artist_now",
            f"Ещё {artist} — ты его сейчас слушаешь" if ru else f"More {artist} — you're on it now",
            {"artist": artist},
            details,
        )
    if "colisten" in sources and ref_track:
        return Reason(
            "colisten",
            f"Ты часто слушаешь это рядом с «{ref_track}»"
            if ru
            else f"You often play this next to “{ref_track}”",
            {"track": ref_track},
            details,
        )
    if "clap" in sources and ref_track:
        return Reason(
            "similar_to",
            f"Похоже по звучанию на «{ref_track}»" if ru else f"Sounds like “{ref_track}”",
            {"track": ref_track},
            details,
        )
    if artist and ({"a_full_rate", "a_plays"} & feats or "artist_affinity" in sources):
        return Reason(
            "artist_love",
            f"Ты почти всегда дослушиваешь {artist}"
            if ru
            else f"You nearly always finish {artist}",
            {"artist": artist},
            details,
        )
    if sound:
        band = (
            ("спокойнее" if sound == "low" else "бодрее")
            if ru
            else ("calmer" if sound == "low" else "more energetic")
        )
        return Reason(
            "preset_match",
            f"Под пресет: {band} большей части библиотеки"
            if ru
            else f"For the preset: {band} than most of your library",
            details=details,
        )
    return Reason(
        "artist_love" if artist else "new_for_you",
        (f"Из твоих любимых: {artist}" if artist else "Для тебя")
        if ru
        else (f"From your favourites: {artist}" if artist else "For you"),
        {"artist": artist} if artist else {},
        details,
    )
