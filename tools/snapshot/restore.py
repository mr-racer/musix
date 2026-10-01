"""Restore a snapshot's Qdrant part into the DEV Qdrant and make a working copy of
metadata.db for v1 drivers (gates, benches). Never points at prod.

Usage: uv run --project server python tools/snapshot/restore.py <date> [qdrant_url]
"""

from __future__ import annotations

import gzip
import json
import shutil
import sys
from pathlib import Path

from qdrant_client import QdrantClient, models

from take import ROOT

DEV_QDRANT = "http://127.0.0.1:18333"


def restore(snap: Path, url: str) -> dict[str, tuple[int, int]]:
    client = QdrantClient(url=url, timeout=120)
    configs = json.loads((snap / "qdrant" / "collections.json").read_text())
    counts: dict[str, tuple[int, int]] = {}
    for name, cfg in configs.items():
        if client.collection_exists(name):
            client.delete_collection(name)
        client.create_collection(
            name,
            vectors_config={k: models.VectorParams(**v) for k, v in cfg["vectors"].items()},
            sparse_vectors_config={k: models.SparseVectorParams(**v)
                                   for k, v in cfg["sparse_vectors"].items()} or None)
        for field, dtype in cfg["payload_schema"].items():
            client.create_payload_index(name, field, field_schema=models.PayloadSchemaType(dtype))
        # Batches are bounded by BYTES as well as count: payloads are heavy (lyrics,
        # per-chunk CLAP), and Qdrant rejects a JSON body over 32 MB.
        batch: list[models.PointStruct] = []
        size = 0
        with gzip.open(snap / "qdrant" / f"{name}.jsonl.gz", "rt", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                vec = {k: models.SparseVector(**v) if isinstance(v, dict) else v
                       for k, v in r["vector"].items()}
                batch.append(models.PointStruct(id=r["id"], vector=vec, payload=r["payload"]))
                size += len(line)
                if len(batch) == 128 or size > 12_000_000:
                    client.upsert(name, batch, wait=True)
                    batch, size = [], 0
        if batch:
            client.upsert(name, batch, wait=True)
        counts[name] = (client.count(name, exact=True).count, cfg["points_count"])
    return counts


def main() -> None:
    snap = ROOT / sys.argv[1]
    url = sys.argv[2] if len(sys.argv) > 2 else DEV_QDRANT
    if ":6333" in url and "18333" not in url:
        raise SystemExit("refusing a non-dev Qdrant URL")
    work = snap / "work"
    work.mkdir(exist_ok=True)
    shutil.copy2(snap / "metadata.db", work / "metadata.db")
    for name, (got, want) in restore(snap, url).items():
        print(f"{name}: {got} points (snapshot {want}){'' if got == want else '  MISMATCH'}")
    print(f"working copy: {work / 'metadata.db'}")


if __name__ == "__main__":
    main()
