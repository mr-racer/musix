"""v2 → v1 reverse export, the rollback's data half (phase 6 spec §5).

    reverse.py --dsn postgresql://…/musix --since 2026-10-07T09:00:00Z --v1 path/to/metadata.db [--dry-run]

Everything v2 recorded since the switch goes back into v1's SQLite, so a rollback loses
nothing a user did on v2:

- new accounts (argon2id hashes are the same format both ways) and invites;
- listen events and огонёк/вода signals, on tracks v1 knows (its `track_metadata`);
- playlists created or edited since the switch: the whole item list in v2's order;
  deleted ones are deleted.

New uploads stay on disk and come back through a v1 rescan. Run it on the **stopped** v1's
database (or a copy for a rehearsal) — never while v1 is serving. Idempotent: a
`v2_reverse_log` table in the v1 file records every v2 id already written (v1 ignores
tables it does not know), so a second run adds nothing.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import uuid
from typing import Any

import psycopg

LOG = """create table if not exists v2_reverse_log (
    v2_id text not null, kind text not null, v1_id text, at text not null,
    primary key (v2_id, kind))"""


def v1_ts(t: dt.datetime | None) -> str | None:
    return t.astimezone(dt.UTC).strftime("%Y-%m-%d %H:%M:%S") if t else None


def collection(account: uuid.UUID) -> str:
    return f"acct_{account.hex}"


class Reverse:
    def __init__(self, pg: psycopg.Connection[Any], v1: sqlite3.Connection, since: dt.datetime) -> None:
        self.pg, self.v1, self.since = pg, v1, since
        self.v1.execute(LOG)
        self.n: dict[str, int] = {}

    def seen(self, v2_id: str, kind: str) -> str | None:
        r = self.v1.execute("select coalesce(v1_id, '') from v2_reverse_log where v2_id = ? and kind = ?", (v2_id, kind)).fetchone()
        return None if r is None else r[0]

    def mark(self, v2_id: str, kind: str, v1_id: Any = None) -> None:
        self.v1.execute("insert or replace into v2_reverse_log values (?, ?, ?, ?)",
                        (v2_id, kind, None if v1_id is None else str(v1_id), v1_ts(dt.datetime.now(dt.UTC))))

    def bump(self, k: str) -> None:
        self.n[k] = self.n.get(k, 0) + 1

    def q(self, sql: str, *args: Any) -> list[tuple[Any, ...]]:
        return self.pg.execute(sql, args).fetchall()

    def accounts(self) -> None:
        model = self.v1.execute("select text_model_name from users limit 1").fetchone()
        for aid, email, pw, role, created, last in self.q(
            "select id, email, password_hash, role, created_at, last_login_at from accounts where created_at >= %s", self.since
        ):
            if self.v1.execute("select 1 from users where id = ?", (aid.hex,)).fetchone():
                continue
            self.v1.execute(
                "insert into users (id, email, password_hash, role, created_at, last_login_at, premium, text_model_name) values (?, ?, ?, ?, ?, ?, 0, ?)",
                (aid.hex, email, pw, role, created.timestamp(), last.timestamp() if last else None, model[0] if model else ""),
            )
            self.bump("accounts")
        for code, by, created, expires, consumed_by, consumed_at in self.q(
            "select code, created_by, created_at, expires_at, consumed_by, consumed_at from invites where created_at >= %s or consumed_at >= %s",
            self.since, self.since,
        ):
            self.v1.execute(
                "insert into invites (code, created_by, created_at, expires_at, consumed_by, consumed_at) values (?, ?, ?, ?, ?, ?) "
                "on conflict(code) do update set consumed_by = excluded.consumed_by, consumed_at = excluded.consumed_at",
                (code, by.hex, created.timestamp(), expires.timestamp(), consumed_by.hex if consumed_by else None,
                 consumed_at.timestamp() if consumed_at else None),
            )
            self.bump("invites")

    def known(self, account: uuid.UUID, track: uuid.UUID) -> bool:
        return self.v1.execute("select 1 from track_metadata where collection_name = ? and track_id = ?",
                               (collection(account), str(track))).fetchone() is not None

    def listening(self) -> None:
        for cid, acct, track, session, started, played, dur, early, touched, infl, source in self.q(
            "select client_event_id, account_id, track_id, session_id, started_at, played_ms, duration_ms, skipped_early, interacted, influence, source "
            "from listen_events where started_at >= %s order by started_at", self.since,
        ):
            if self.seen(str(cid), "listen") is not None:
                continue
            if not self.known(acct, track):
                self.bump("listens_unknown_track")
                self.mark(str(cid), "listen")
                continue
            cur = self.v1.execute(
                "insert into playback_events (session_id, collection_name, track_id, played_at, played_sec, total_dur, skipped_early, interacted, influence, source) "
                "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (session, collection(acct), str(track), v1_ts(started), played / 1000, (dur or 0) / 1000,
                 int(bool(early)), int(bool(touched)), int(infl) if infl is not None else 1, source),
            )
            self.mark(str(cid), "listen", cur.lastrowid)
            self.bump("listens")
        for cid, acct, session, track, kind, created in self.q(
            "select client_event_id, account_id, session_id, track_id, kind, created_at from taste_signals where created_at >= %s order by created_at", self.since,
        ):
            if self.seen(str(cid), "signal") is not None or not self.known(acct, track):
                continue
            cur = self.v1.execute("insert into taste_signals (collection_name, session_id, track_id, kind, created_at) values (?, ?, ?, ?, ?)",
                                  (collection(acct), session, str(track), kind, v1_ts(created)))
            self.mark(str(cid), "signal", cur.lastrowid)
            self.bump("signals")

    def playlists(self) -> None:
        # v2 ids of migrated playlists are uuid5(NS, "playlist:<v1 id>"): map them back
        from migrate import NS  # the migrator's namespace, the same run of ids

        by_v2 = {uuid.uuid5(NS, f"playlist:{pid}"): pid for (pid,) in self.v1.execute("select id from playlists")}
        for (v2, v1id) in self.v1.execute("select v2_id, v1_id from v2_reverse_log where kind = 'playlist'").fetchall():
            by_v2[uuid.UUID(v2)] = int(v1id)
        touched = {r[0] for r in self.q(
            "select distinct entity_id from change_log where entity in ('playlist', 'playlistItem') and at >= %s", self.since)}
        changed = self.q(
            "select id, account_id, name, description, created_at, updated_at from playlists where updated_at >= %s or created_at >= %s",
            self.since, self.since,
        )
        live = set()
        for pid, acct, name, desc, created, updated in changed:
            live.add(pid)
            v1id = by_v2.get(pid)
            if v1id is None:
                cur = self.v1.execute("insert into playlists (collection_name, name, description, created_at, updated_at) values (?, ?, ?, ?, ?)",
                                      (collection(acct), name, desc, v1_ts(created), v1_ts(updated)))
                v1id = cur.lastrowid
                self.mark(str(pid), "playlist", v1id)
                self.bump("playlists_new")
            else:
                self.v1.execute("update playlists set name = ?, description = ?, updated_at = ? where id = ?", (name, desc, v1_ts(updated), v1id))
                self.bump("playlists_edited")
            self.v1.execute("delete from playlist_tracks where playlist_id = ?", (v1id,))
            items = self.q("select track_id, added_at from playlist_items where playlist_id = %s order by position", pid)
            pos = 0
            for track, added in items:
                if not self.known(acct, track):
                    continue
                self.v1.execute("insert into playlist_tracks (playlist_id, track_id, position, added_at) values (?, ?, ?, ?)",
                                (v1id, str(track), pos, v1_ts(added)))
                pos += 1
        # deleted on v2 since the switch: a playlist change_log id that no longer exists
        for entity_id in touched:
            try:
                pid = uuid.UUID(entity_id)
            except ValueError:
                continue  # a playlistItem's id
            if pid in live or pid not in by_v2:
                continue
            if not self.q("select 1 from playlists where id = %s", pid):
                self.v1.execute("delete from playlist_tracks where playlist_id = ?", (by_v2[pid],))
                self.v1.execute("delete from playlists where id = ?", (by_v2[pid],))
                self.bump("playlists_deleted")

    def run(self, dry_run: bool) -> dict[str, int]:
        try:
            self.accounts()
            self.listening()
            self.playlists()
        except Exception:
            self.v1.rollback()
            raise
        if dry_run:
            self.v1.rollback()
        else:
            self.v1.commit()
        return self.n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dsn", required=True, help="the v2 database")
    ap.add_argument("--since", required=True, type=dt.datetime.fromisoformat, help="the switch time, ISO 8601 with a zone")
    ap.add_argument("--v1", required=True, help="v1's metadata.db (stopped v1, or a copy)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.since.tzinfo is None:
        raise SystemExit("--since needs a time zone (e.g. …Z)")
    with psycopg.connect(a.dsn) as pg:
        v1 = sqlite3.connect(a.v1)
        print(json.dumps(Reverse(pg, v1, a.since).run(a.dry_run), ensure_ascii=False))


if __name__ == "__main__":
    main()
