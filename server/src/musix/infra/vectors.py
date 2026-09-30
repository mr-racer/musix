"""The Qdrant layout (spec §3): ONE `tracks` collection for every account, keyed by
content (`media_files.id`), filtered by `owners`. The payload holds filters only — no
titles, no lyrics: hits come back as ids and the metadata comes from Postgres in one
batched query."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from qdrant_client import AsyncQdrantClient, models

TRACKS = "tracks"
BM25 = "Qdrant/bm25"  # Qdrant's server-side inference, as v1 (vectors migrate as they are)
AXES = ("energy", "vocal_lead", "spacious", "experimental", "brightness", "acousticness")
_ready: set[str] = set()


def client(url: str) -> AsyncQdrantClient:
    # trust_env=False: internal traffic never goes through a proxy (v1 invariant)
    return AsyncQdrantClient(url=url, timeout=30, trust_env=False)


async def ensure(q: AsyncQdrantClient) -> None:
    """Create `tracks` and its payload indexes once; cheap to call from every process."""
    if TRACKS in _ready:
        return
    if not await q.collection_exists(TRACKS):
        await q.create_collection(
            TRACKS,
            vectors_config={
                "text": models.VectorParams(size=1024, distance=models.Distance.COSINE),
                "clap": models.VectorParams(size=512, distance=models.Distance.COSINE),
                "clap_chunks": models.VectorParams(
                    size=512,
                    distance=models.Distance.COSINE,
                    multivector_config=models.MultiVectorConfig(
                        comparator=models.MultiVectorComparator.MAX_SIM
                    ),
                    hnsw_config=models.HnswConfigDiff(m=0),  # rescoring only, never an ANN entry
                ),
            },
            sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
        )
        keyword = models.PayloadSchemaType.KEYWORD
        indexes: dict[str, Any] = {
            "owners": models.KeywordIndexParams(
                type=models.KeywordIndexType.KEYWORD, is_tenant=True
            ),
            "artist_ids": keyword,
            "album_id": keyword,
            "genre": keyword,
            "year": models.PayloadSchemaType.INTEGER,
            "duration_ms": models.PayloadSchemaType.INTEGER,
            **dict.fromkeys(AXES, models.PayloadSchemaType.FLOAT),
        }
        for field, schema in indexes.items():
            await q.create_payload_index(TRACKS, field, field_schema=schema)
    _ready.add(TRACKS)


def owned_by(account_id: uuid.UUID, extra: Iterable[models.Condition] = ()) -> models.Filter:
    """The filter every query carries: a listener only ever sees their own library."""
    return models.Filter(
        must=[
            models.FieldCondition(key="owners", match=models.MatchValue(value=str(account_id))),
            *extra,
        ]
    )
