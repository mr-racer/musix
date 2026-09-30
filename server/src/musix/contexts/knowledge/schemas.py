import datetime as dt
import uuid
from typing import Any

from musix.schemas import Model


class FactOut(Model):
    text: str
    labels: list[str]  # facts_v2 labels; [] for a raw (unrefined) fact
    confirmed: bool
    source: str | None


class RelationOut(Model):
    text: str  # "Artist — Title" for songs, a name for producers and labels
    kind: str  # producer | label | sample | interpolation | sampled_by | interpolated_by
    song_id: uuid.UUID | None
    track_id: uuid.UUID | None  # the account's own track of that song, when it has one
    artist_id: uuid.UUID | None
    verified: bool | None


class TrackKnowledge(Model):
    """Everything the player shows about a track. Refined facts win per subject; a subject
    facts_v2 has seen but kept nothing of is [] (a real answer, not «not yet»)."""

    song_facts: list[FactOut]
    artist_facts: list[FactOut]
    refined: bool  # the song's facts are facts_v2 output in the requested language
    producers: list[RelationOut]
    labels: list[RelationOut]
    samples: list[RelationOut]  # what this track samples or interpolates
    sampled_by: list[RelationOut]
    vibe: str | None  # the sonic vibe line


class BioOut(Model):
    artist_id: uuid.UUID
    lang: str
    text: str
    facets: dict[str, Any]
    sources: dict[str, Any]
    generated_at: dt.datetime
