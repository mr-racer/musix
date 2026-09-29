"""`GET /sync` (spec §7): offline-first clients mirror the account from pages of
changes. State-based: a change_log row only says "look at this entity again", and the
page carries the entity as it is NOW — a row that is gone or soft-deleted becomes a
tombstone. Replays are harmless, so the cursor can be at-least-once.

- no cursor → a snapshot of every entity, keyset-paged, read at a `seq` high-water
  mark taken FIRST: whatever changes during the dump has seq > hwm and arrives in the
  delta that follows, so nothing is lost;
- a delta cursor → change_log rows after it, ≤ limit per page."""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.identity.models import account_settings
from musix.contexts.library.models import albums, artists, images, track_artists, tracks
from musix.contexts.library.service import get_tracks
from musix.contexts.listening.models import taste_signals
from musix.contexts.media.delivery import image_url
from musix.contexts.playlists.models import playlist_items, playlists
from musix.contexts.playlists.service import _LIVE_ITEMS
from musix.contexts.sync import schemas as S
from musix.errors import Invalid
from musix.infra.tables import change_log

IMAGE_SIZES = (96, 256, 512, 1024)
T, Al, Ar, Ta, Im = tracks.c, albums.c, artists.c, track_artists.c, images.c
Pl, It, Sg = playlists.c, playlist_items.c, taste_signals.c


@dataclass(frozen=True)
class Ctx:
    s: AsyncSession
    account_id: uuid.UUID
    base_url: str
    image_secret: bytes


Keys = Callable[[Ctx, str | None, int], Awaitable[list[str]]]
Load = Callable[[Ctx, list[str]], Awaitable[dict[str, BaseModel]]]


def _uuids(ids: Iterable[str]) -> list[uuid.UUID]:
    return [uuid.UUID(i) for i in ids]


async def _ids(c: Ctx, q: sa.Select[Any], col: Any, after: str | None, n: int) -> list[str]:
    """Keyset over one sortable column of a `select distinct col`."""
    sub = q.subquery()
    k = sub.c[0]
    stmt = sa.select(k).order_by(k).limit(n)
    if after is not None:
        stmt = stmt.where(k > (uuid.UUID(after) if col is uuid.UUID else after))
    found: Iterable[Any] = await c.s.scalars(stmt)
    return [str(x) for x in found]


# -- the account's live tracks and what they reference ------------------------------


def _live_tracks(c: Ctx) -> sa.ColumnElement[bool]:
    return sa.and_(T.account_id == c.account_id, T.deleted_at.is_(None))


def _album_ids(c: Ctx) -> sa.Select[Any]:
    return sa.select(T.album_id).where(_live_tracks(c), T.album_id.is_not(None)).distinct()


def _artist_ids(c: Ctx) -> sa.Select[Any]:
    via_tracks = (
        sa.select(Ta.artist_id.label("id")).join(tracks, T.id == Ta.track_id).where(_live_tracks(c))
    )
    via_albums = sa.select(Al.album_artist_id).where(
        Al.id.in_(_album_ids(c)), Al.album_artist_id.is_not(None)
    )
    return sa.union(via_tracks, via_albums)  # type: ignore[return-value]


def _image_ids(c: Ctx) -> sa.Select[Any]:
    return sa.union(  # type: ignore[return-value]
        sa.select(T.cover_image_id.label("id")).where(
            _live_tracks(c), T.cover_image_id.is_not(None)
        ),
        sa.select(Al.cover_image_id).where(
            Al.id.in_(_album_ids(c)), Al.cover_image_id.is_not(None)
        ),
        sa.select(Ar.image_id).where(Ar.id.in_(_artist_ids(c)), Ar.image_id.is_not(None)),
        sa.select(Pl.cover_image_id).where(
            Pl.account_id == c.account_id, Pl.deleted_at.is_(None), Pl.cover_image_id.is_not(None)
        ),
    )


# -- entities ------------------------------------------------------------------------


async def _load_images(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    rows = await c.s.execute(sa.select(images).where(Im.id.in_(ids)))
    return {
        r.id: S.ImageData(
            id=r.id,
            width=r.width,
            height=r.height,
            blurhash=r.blurhash,
            palette=r.palette,
            urls={
                str(px): url
                for px in IMAGE_SIZES
                if str(px) in (r.variants or {})
                and (url := image_url(c.base_url, c.image_secret, r.id, px))
            },
        )
        for r in rows
    }


async def _load_artists(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    rows = await c.s.execute(sa.select(artists).where(Ar.id.in_(_uuids(ids))))
    return {str(r.id): S.ArtistData.model_validate(r._mapping) for r in rows}


async def _load_albums(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    rows = await c.s.execute(sa.select(albums).where(Al.id.in_(_uuids(ids))))
    return {str(r.id): S.AlbumData.model_validate(r._mapping) for r in rows}


async def _load_tracks(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    return {str(t.id): t for t in await get_tracks(c.s, c.account_id, _uuids(ids))}


async def _load_playlists(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    from musix.contexts.playlists.schemas import PlaylistOut

    rows = await c.s.execute(
        sa.select(playlists, _LIVE_ITEMS).where(
            Pl.id.in_(_uuids(ids)), Pl.account_id == c.account_id, Pl.deleted_at.is_(None)
        )
    )
    return {str(r.id): PlaylistOut.model_validate(r._mapping) for r in rows}


async def _load_items(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    rows = await c.s.execute(
        sa.select(It.item_id, It.playlist_id, It.track_id, It.position, It.added_at)
        .join(playlists, Pl.id == It.playlist_id)
        .where(
            It.item_id.in_(_uuids(ids)),
            It.deleted_at.is_(None),
            Pl.account_id == c.account_id,
            Pl.deleted_at.is_(None),
        )
    )
    return {str(r.item_id): S.PlaylistItemData.model_validate(r._mapping) for r in rows}


async def _load_signals(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    rows = await c.s.execute(
        sa.select(Sg.track_id, Sg.kind, Sg.created_at)
        .where(Sg.account_id == c.account_id, Sg.track_id.in_(_uuids(ids)))
        .ext(distinct_on(Sg.track_id))
        .order_by(Sg.track_id, Sg.created_at.desc())
    )
    return {str(r.track_id): S.SignalData.model_validate(r._mapping) for r in rows}


async def _load_settings(c: Ctx, ids: list[str]) -> dict[str, BaseModel]:
    if str(c.account_id) not in ids:
        return {}
    v = await c.s.scalar(
        sa.select(account_settings.c.value).where(account_settings.c.account_id == c.account_id)
    )
    return {str(c.account_id): S.SettingsData(value=dict(v or {}))}


def _keys(q: Callable[[Ctx], sa.Select[Any]], col: Any) -> Keys:
    async def keys(c: Ctx, after: str | None, n: int) -> list[str]:
        return await _ids(c, q(c), col, after, n)

    return keys


async def _settings_keys(c: Ctx, after: str | None, n: int) -> list[str]:
    return [str(c.account_id)] if after is None else []


@dataclass(frozen=True)
class Entity:
    name: str
    change: type[BaseModel]
    keys: Keys
    load: Load


# Snapshot order = reference order: an entity arrives after what it points at.
ENTITIES = [
    Entity("settings", S.SettingsChange, _settings_keys, _load_settings),
    Entity("image", S.ImageChange, _keys(_image_ids, str), _load_images),
    Entity("artist", S.ArtistChange, _keys(_artist_ids, uuid.UUID), _load_artists),
    Entity("album", S.AlbumChange, _keys(_album_ids, uuid.UUID), _load_albums),
    Entity(
        "track",
        S.TrackChange,
        _keys(lambda c: sa.select(T.id).where(_live_tracks(c)), uuid.UUID),
        _load_tracks,
    ),
    Entity(
        "playlist",
        S.PlaylistChange,
        _keys(
            lambda c: sa.select(Pl.id).where(
                Pl.account_id == c.account_id, Pl.deleted_at.is_(None)
            ),
            uuid.UUID,
        ),
        _load_playlists,
    ),
    Entity(
        "playlistItem",
        S.PlaylistItemChange,
        _keys(
            lambda c: (
                sa.select(It.item_id)
                .join(playlists, Pl.id == It.playlist_id)
                .where(
                    Pl.account_id == c.account_id, Pl.deleted_at.is_(None), It.deleted_at.is_(None)
                )
            ),
            uuid.UUID,
        ),
        _load_items,
    ),
    Entity(
        "signalState",
        S.SignalStateChange,
        _keys(
            lambda c: sa.select(Sg.track_id).where(Sg.account_id == c.account_id).distinct(),
            uuid.UUID,
        ),
        _load_signals,
    ),
]
BY_NAME = {e.name: e for e in ENTITIES}
_IMAGE_REFS = {
    "track": "cover_image_id",
    "album": "cover_image_id",
    "artist": "image_id",
    "playlist": "cover_image_id",
}


# -- cursor --------------------------------------------------------------------------


def encode(d: dict[str, Any]) -> str:
    return (
        base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).decode().rstrip("=")
    )


def decode(cursor: str) -> dict[str, Any]:
    try:
        d = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if not isinstance(d, dict) or not ({"s"} <= d.keys() or {"h", "p"} <= d.keys()):
            raise ValueError
        return d
    except (ValueError, binascii.Error, UnicodeDecodeError) as e:
        raise Invalid("malformed cursor") from e


def delta_cursor(seq: int) -> str:
    return encode({"s": seq})


async def head_seq(s: AsyncSession, account_id: uuid.UUID) -> int:
    return int(
        await s.scalar(
            sa.select(sa.func.coalesce(sa.func.max(change_log.c.seq), 0)).where(
                change_log.c.account_id == account_id
            )
        )
        or 0
    )


# -- pages ---------------------------------------------------------------------------


def _change(e: Entity, id_: str, data: BaseModel | None) -> Any:
    return e.change.model_validate(
        {"entity": e.name, "id": id_, "op": "upsert" if data else "delete", "data": data}
    )


async def snapshot_page(c: Ctx, hwm: int, phase: int, key: str | None, limit: int) -> S.SyncPage:
    out: list[Any] = []
    while len(out) < limit and phase < len(ENTITIES):
        e = ENTITIES[phase]
        want = limit - len(out)
        ids = await e.keys(c, key, want)
        data = await e.load(c, ids)
        out += [
            _change(e, i, data[i]) for i in ids if i in data
        ]  # vanished mid-dump: the delta says so
        if len(ids) < want:
            phase, key = phase + 1, None
        else:
            key = ids[-1]
    if phase < len(ENTITIES):
        return S.SyncPage(
            changes=out, cursor=encode({"h": hwm, "p": phase, "k": key}), has_more=True
        )
    more = await c.s.scalar(
        sa.select(
            sa.exists().where(change_log.c.account_id == c.account_id, change_log.c.seq > hwm)
        )
    )
    return S.SyncPage(changes=out, cursor=delta_cursor(hwm), has_more=bool(more))


async def delta_page(c: Ctx, after: int, limit: int) -> S.SyncPage:
    rows = (
        await c.s.execute(
            sa.select(change_log.c.seq, change_log.c.entity, change_log.c.entity_id)
            .where(change_log.c.account_id == c.account_id, change_log.c.seq > after)
            .order_by(change_log.c.seq)
            .limit(limit + 1)
        )
    ).all()
    more, rows = len(rows) > limit, rows[:limit]
    touched: dict[str, dict[str, None]] = {}  # entity → ids, deduped, ordered
    for r in rows:
        if r.entity in BY_NAME:
            touched.setdefault(r.entity, {})[r.entity_id] = None
    loaded = {name: await BY_NAME[name].load(c, list(ids)) for name, ids in touched.items()}
    # an upserted entity brings its image along (images are not change-logged: immutable)
    refs = {
        img
        for name, data in loaded.items()
        if name in _IMAGE_REFS
        for d in data.values()
        if (img := getattr(d, _IMAGE_REFS[name], None))
    } - set(touched.get("image", {}))
    if refs:
        touched["image"] = {**touched.get("image", {}), **dict.fromkeys(sorted(refs))}
        loaded["image"] = {**loaded.get("image", {}), **await _load_images(c, sorted(refs))}
    out = [
        _change(e, i, loaded[e.name].get(i))
        for e in ENTITIES
        if e.name in touched
        for i in touched[e.name]
    ]
    return S.SyncPage(
        changes=out, cursor=delta_cursor(rows[-1].seq if rows else after), has_more=more
    )


async def page(c: Ctx, cursor: str | None, limit: int) -> S.SyncPage:
    if cursor is None:
        return await snapshot_page(c, await head_seq(c.s, c.account_id), 0, None, limit)
    d = decode(cursor)
    try:
        if "s" in d:
            return await delta_page(c, int(d["s"]), limit)
        phase = int(d["p"])
        if not 0 <= phase < len(ENTITIES):
            raise ValueError
        return await snapshot_page(c, int(d["h"]), phase, d.get("k"), limit)
    except (ValueError, TypeError) as e:
        raise Invalid("malformed cursor") from e
