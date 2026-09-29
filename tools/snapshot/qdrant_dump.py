"""Dump every Qdrant collection by SCROLLING (read-only): the snapshot API would
write snapshot files into prod's storage. Runs inside a throwaway container on the
prod network, because prod's Qdrant port is not published on the host.

Usage: python qdrant_dump.py <qdrant_url> <out_dir>
Writes <out_dir>/<collection>.jsonl.gz and <out_dir>/collections.json.
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path
from typing import Any

from qdrant_client import QdrantClient, models


def vec_json(v: Any) -> Any:
    if isinstance(v, models.SparseVector):
        return {"indices": v.indices, "values": v.values}
    return v


def main(url: str, out: Path) -> None:
    client = QdrantClient(url=url, timeout=120)
    configs: dict[str, Any] = {}
    for c in client.get_collections().collections:
        info = client.get_collection(c.name)
        params = info.config.params
        vectors = params.vectors if isinstance(params.vectors, dict) else {"": params.vectors}
        configs[c.name] = {
            "vectors": {k: v.model_dump(mode="json", exclude_none=True) for k, v in (vectors or {}).items()},
            "sparse_vectors": {k: v.model_dump(mode="json", exclude_none=True)
                               for k, v in (params.sparse_vectors or {}).items()},
            "payload_schema": {k: v.data_type.value for k, v in (info.payload_schema or {}).items()},
            "points_count": info.points_count,
        }
        n, offset = 0, None
        with gzip.open(out / f"{c.name}.jsonl.gz", "wt", encoding="utf-8") as f:
            while True:
                pts, offset = client.scroll(c.name, limit=256, offset=offset,
                                            with_vectors=True, with_payload=True)
                for p in pts:
                    vec = p.vector if isinstance(p.vector, dict) else {"": p.vector}
                    f.write(json.dumps({"id": p.id, "vector": {k: vec_json(v) for k, v in vec.items()},
                                        "payload": p.payload}, ensure_ascii=False) + "\n")
                    n += 1
                if offset is None:
                    break
        print(f"qdrant {c.name}: {n} points", flush=True)
    (out / "collections.json").write_text(json.dumps(configs, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
