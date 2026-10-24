import uuid
from typing import Literal

from musix.schemas import Model


class Label(Model):
    """A word of the profile: `key` is stable (filters, clients' own wording), `label` is it
    in the request's language."""

    key: str
    label: str


class Ratings(Model):
    """The three absolute 0–100 scales (library-independent, fixed formulas); `space` is null
    for a mono file. Facets: space {width, spread, echo}, tech {layers, sound_work, playing,
    development}, odd {sounds, mix_extremes, form, style?}."""

    space: int | None
    tech: int
    odd: int
    facets: dict[str, dict[str, int]]


class Section(Model):
    start: float
    end: float
    kind: str
    label: str


class Moment(Model):
    """A moment worth hearing (≤ 8 a song), in its section."""

    t: float
    kind: str
    label: str
    section: str


class StemPlace(Model):
    stem: str
    name: Label
    side: Label
    pan: float
    width: float


class TrackSound(Model):
    ratings: Ratings
    instruments: list[Label]
    drums: Label | None
    vocals: Label | None
    pace: Label | None
    feel: Label | None
    echo: Label
    width: Label | None
    traits: list[str]
    sections: list[Section]
    moments: list[Moment]
    stems: list[StemPlace]
    signature: str | None
    has_stage: bool
    ver: int


class SoundStatus(Model):
    holder: Literal["ml", "sound"]
    lease_since: str
    lease_reason: str | None
    batch: str | None
    stage: str | None
    pending_uploads: int
    pending_backfill: int
    running: int
    done: int
    failed: int
    skipped: int
    eta_hours: float | None


class PoolEnd(Model):
    value: int
    title: str


class PoolScale(Model):
    """A scale pooled over an album: the mean, the songs at both ends, the mean facets."""

    mean: int
    min: PoolEnd
    max: PoolEnd
    facets: dict[str, int]


class TraitShare(Model):
    key: str
    label: str
    share: float  # of the album's analysed songs


class AlbumPool(Model):
    album_id: uuid.UUID
    title: str
    year: int | None
    n: int  # analysed recordings pooled
    tech: PoolScale | None
    space: PoolScale | None  # null when every song is mono
    odd: PoolScale | None
    traits: list[TraitShare]
    tempo: list[Label]  # most common first


class AlbumSound(Model):
    """The album's sound pooled from every analysed recording on it (≥3), and its validated
    text: what the album sounds like and what moved since the artist's album before it."""

    pool: AlbumPool
    text: str | None


class ArtistSound(Model):
    """The artist's pooled albums by year and the timeline of how the sound moved."""

    albums: list[AlbumPool]
    timeline: str | None
