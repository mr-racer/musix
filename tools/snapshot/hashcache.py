"""sha256 of media files, cached by (path, size, mtime): the first run reads the
whole library (~237 GB, ~25 min on the HDD), later runs only new or changed files."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

CHUNK = 1 << 20


class HashCache:
    def __init__(self, db: Path) -> None:
        self.conn = sqlite3.connect(db)
        self.conn.execute("create table if not exists h (path text primary key, size integer, "
                          "mtime real, sha256 text)")
        self.hits = self.misses = 0

    def sha256(self, path: Path) -> tuple[int, float, str]:
        st = path.stat()
        row = self.conn.execute("select sha256 from h where path=? and size=? and mtime=?",
                                (str(path), st.st_size, st.st_mtime)).fetchone()
        if row:
            self.hits += 1
            return st.st_size, st.st_mtime, str(row[0])
        h = hashlib.sha256()
        with path.open("rb") as f:
            while chunk := f.read(CHUNK):
                h.update(chunk)
        digest = h.hexdigest()
        self.conn.execute("insert or replace into h values (?,?,?,?)",
                          (str(path), st.st_size, st.st_mtime, digest))
        self.misses += 1
        if self.misses % 200 == 0:
            self.conn.commit()
        return st.st_size, st.st_mtime, digest

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()
