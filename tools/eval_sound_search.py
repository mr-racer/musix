"""Eval set of sound requests (spec sound-search-profile §10): each query through the assistant
as it is («only CLAP») and with the song's sound profile, side by side, with the automatic
checks of §10.2 and a Markdown report for the owner's blind comparison.

Runs INSIDE the api container, read-only by construction: the database sessions (async and
the catalog's psycopg) open with `default_transaction_read_only=on`, and the LLM is called
with its cache off — no reads, so the repeated runs measure the model's own variance, and
no writes. The code under test is put on PYTHONPATH:

    docker cp <worktree>/server/src musix-v2-api-1:/tmp/sound-eval/src
    docker cp <worktree>/tools/eval_sound_search.py musix-v2-api-1:/tmp/sound-eval/
    docker cp <worktree>/server/tests/assistant/sound_queries.yaml musix-v2-api-1:/tmp/sound-eval/
    docker exec -e PYTHONPATH=/tmp/sound-eval/src -e CUDA_VISIBLE_DEVICES= musix-v2-api-1 \\
        python /tmp/sound-eval/eval_sound_search.py --account <uuid> --runs 3 \\
        > /mnt/data/musix-snapshots/sound-eval-<date>.md

The report names real tracks of the library: it belongs in /mnt/data/musix-snapshots/,
never in git.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
import uuid
from contextlib import suppress
from pathlib import Path
from typing import Any

import sqlalchemy as sa
import yaml

SKIT_KEYS = {"odd", "calm", "tech"}
TOP = 10


class NoCacheLlm:
    """The instance's LLM with `llm_cache` neither read nor written."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner

    async def chat(self, messages: Any, **kw: Any) -> str:
        kw["cache"] = False
        return str(await self.inner.chat(messages, **kw))

    async def ask(self, prompt: str, **kw: Any) -> str:
        kw["cache"] = False
        return str(await self.inner.ask(prompt, **kw))

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


class Status:
    """fast.answer's sink: it only reports stages."""

    def on_status(self, _: Any) -> None:
        pass


class WithoutProfile:
    """The search adapter as it was before the profile: no `sound_profiles` and no
    `neighbours`, so the audio branch takes its old path and the playlist branch does not
    filter."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner

    def __getattr__(self, name: str) -> Any:
        if name in ("sound_profiles", "track_hits", "neighbours", "find_track"):
            raise AttributeError(name)
        return getattr(self.inner, name)


def key_str(k: Any) -> str:
    return ("-" if k.neg else "") + k.key


def _local_rate_limits() -> None:
    """The token buckets and breakers live in Postgres, and this run's connections are read
    only: without this every web search fails on «cannot execute UPDATE» and the playlist
    branch degrades to its fallbacks. Here they live in the process, at half the rate — the
    instance's own workers keep their budget, which this run does not see."""
    from musix.infra import ratelimit

    last: dict[str, float] = {}

    async def acquire(_sm: Any, src: Any) -> None:
        gap = 2.0 / src.rate
        wait = last.get(src.name, 0.0) + gap - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        last[src.name] = time.monotonic()

    async def is_open(_sm: Any, _name: str) -> bool:
        return False

    async def record(*_: Any, **__: Any) -> None:
        return None

    ratelimit.acquire = acquire  # type: ignore[assignment]
    ratelimit.is_open = is_open  # type: ignore[assignment]
    ratelimit.record = record  # type: ignore[assignment]


async def setup(account: uuid.UUID) -> dict[str, Any]:
    from musix.contexts.assistant import service as aservice
    from musix.infra import db, secrets
    from musix.infra.llm import Llm
    from musix.workers import context as ctx

    _local_rate_limits()

    st = ctx.settings()
    engine = db.make_engine(st, statement_timeout_ms=120_000)

    @sa.event.listens_for(engine.sync_engine, "connect")
    def _read_only(dbapi_conn: Any, _: Any) -> None:
        cur = dbapi_conn.cursor()
        cur.execute("SET default_transaction_read_only = on")
        cur.close()

    sm = db.make_sessionmaker(engine)
    llm = Llm(
        sm,
        secrets.fernet_only(st.secrets_dir),
        st.llm_base_url,
        st.llm_model,
        st.llm_api_key.get_secret_value() if st.llm_api_key else None,
    )
    sep = "&" if "?" in st.procrastinate_conninfo else "?"
    conninfo = f"{st.procrastinate_conninfo}{sep}options=-c%20default_transaction_read_only%3Don"
    aservice.bind(sm, NoCacheLlm(llm), conninfo, asyncio.get_running_loop())
    return {"sm": sm, "q": await ctx.qdrant(), "ml": ctx.ml(), "llm": NoCacheLlm(llm)}


async def turn(
    env: dict[str, Any], account: uuid.UUID, text: str, *, profile: bool
) -> dict[str, Any]:
    """One request the way contexts.assistant.service._assistant answers it: the fast path
    first, then the agent. Returns what the checks need."""
    from musix.assistant.agent import Assistant
    from musix.assistant.config import AgentConfig
    from musix.assistant.events import AgentSink
    from musix.assistant.search_adapter import SearchAdapter
    from musix.contexts.assistant import fast

    t0 = time.monotonic()
    real_parse = fast._parse_sound
    if not profile:

        async def _none(*_: Any) -> None:
            return None

        fast._parse_sound = _none  # type: ignore[assignment]
    try:
        quick = await fast.answer(
            env["sm"], env["q"], env["llm"], account, {"message": text, "lang": "ru"}, Status()
        )
    except Exception as exc:
        quick = None
        print(f"<!-- fast path failed on {text!r}: {exc} -->", file=sys.stderr)
    finally:
        fast._parse_sound = real_parse  # type: ignore[assignment]
    if quick is not None:
        return {
            "path": f"fast:{quick.get('fast')}",
            "intent": quick["intent"],
            "artist": None,
            "era": None,
            "keys": [],
            "ids": [t["track_id"] for t in quick["playlist"]["tracks"]],
            "tiers": [],
            "human": quick["playlist"]["title"],
            "secs": time.monotonic() - t0,
        }

    adapter = SearchAdapter(env["sm"], env["q"], env["ml"], account)
    sink = AgentSink(None)
    agent = Assistant(
        str(account),
        config=AgentConfig(lang="ru"),
        sink=sink,
        search_service=adapter if profile else WithoutProfile(adapter),
    )
    result = await agent.run(text)
    plan = (sink.of("plan") or [{}])[-1]
    tracks = getattr(result, "tracks", []) or []
    ids = [str(getattr(getattr(t, "track", t), "track_id", "")) for t in tracks]
    return {
        "path": "agent",
        "intent": plan.get("intent"),
        "artist": plan.get("artist"),
        "era": plan.get("era"),
        "keys": [("-" if k["neg"] else "") + k["key"] for k in plan.get("sound") or []],
        "ids": [i for i in ids if i],
        "tiers": list(getattr(result, "tiers", []) or []),
        "human": getattr(result, "sound_note", "") or getattr(result, "comment", ""),
        "title": getattr(result, "title", "") or "",
        "profile": profile,
        "secs": time.monotonic() - t0,
    }


async def describe(
    env: dict[str, Any], account: uuid.UUID, ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Title, artist, year, length and the profile's words of each track, for the report and
    the checks."""
    from musix.assistant.search_adapter import SearchAdapter
    from musix.contexts.library.models import artists, track_artists, tracks

    if not ids:
        return {}
    uids = [uuid.UUID(i) for i in ids]
    async with env["sm"]() as s:
        rows = (
            await s.execute(
                sa.select(
                    tracks.c.id,
                    sa.func.coalesce(tracks.c.title_display, tracks.c.title),
                    tracks.c.artist_display,
                    tracks.c.year,
                    tracks.c.duration_ms,
                ).where(tracks.c.id.in_(uids))
            )
        ).all()
        credits = (
            await s.execute(
                sa.select(track_artists.c.track_id, artists.c.name)
                .join(artists, artists.c.id == track_artists.c.artist_id)
                .where(track_artists.c.track_id.in_(uids))
            )
        ).all()
    named: dict[str, list[str]] = {}
    for tid, name in credits:
        named.setdefault(str(tid), []).append(name)
    prof = await SearchAdapter(env["sm"], env["q"], env["ml"], account).sound_profiles(
        track_ids=ids
    )
    out = {}
    for tid, title, artist, year, dur in rows:
        p = prof.get(str(tid))
        out[str(tid)] = {
            "title": title,
            "artist": artist,
            # every credit, as the search's own artist filter: «Umbrella» is Jay-Z's too
            "credits": " / ".join([artist or "", *named.get(str(tid), [])]),
            "year": year,
            "secs": (dur or 0) / 1000,
            "profile": p,
        }
    return out


def checks(
    case: dict[str, Any], run: dict[str, Any], info: dict[str, dict[str, Any]], base: list[str]
) -> list[str]:
    """§10.2 points 1–7 for one run; each failed check is one line."""
    from musix.contexts.search.normalize import fold
    from musix.contexts.sound import query as SQ

    bad = []
    want_keys = set(case.get("keys") or [])
    if run["path"] == "agent":
        if case.get("intent") and run["intent"] != case["intent"]:
            bad.append(f"intent {run['intent']} ≠ {case['intent']}")
        if case.get("artist") and fold(case["artist"]) not in fold(run["artist"] or ""):
            bad.append(f"artist {run['artist']!r} ≠ {case['artist']!r}")
        # `also`: soft keys a reading may add without being wrong («много воздуха» → wide)
        if set(run["keys"]) - set(case.get("also") or []) != want_keys:
            bad.append(f"keys {sorted(run['keys'])} ≠ {sorted(want_keys)}")
    elif case.get("fast") is False:
        bad.append(f"answered by {run['path']}, expected the agent")
    if not run["ids"] and case.get("intent", "audio_search") in ("audio_search", "playlist"):
        bad.append("no tracks at all")  # K7 passed every check with an empty list
    keys = [SQ.SoundKey(k.lstrip("-"), neg=k.startswith("-")) for k in want_keys]
    hard = [k for k in keys if k.hard]
    tiers = run["tiers"] or [1] * len(run["ids"])
    for tid, tier in zip(run["ids"], tiers, strict=False):
        t = info.get(tid) or {}
        if tier == 1 and hard and not SQ.passes_all(t.get("profile"), hard):
            bad.append(f"tier 1 «{t.get('title')}» fails {[key_str(k) for k in hard]}")
    if want_keys & SKIT_KEYS:
        short = [
            info[t]["title"]
            for t in run["ids"][:TOP]
            if t in info and 0 < info[t]["secs"] < SQ.MIN_SONG_S
        ]
        if short:
            bad.append(f"short tracks in top-{TOP}: {short}")
    if case.get("artist"):
        off = [
            info[t]["title"]
            for t in run["ids"]
            if t in info and fold(case["artist"]) not in fold(info[t]["credits"] or "")
        ]
        if off:
            bad.append(f"other artists: {off[:5]}")
    era = case.get("era")
    if era:
        off = [
            info[t]["title"]
            for t in run["ids"]
            if t in info and not (info[t]["year"] and era[0] <= info[t]["year"] <= era[1])
        ]
        if off:
            bad.append(f"out of era {era}: {off[:5]}")
    if case.get("group") in ("G", "H") and run["keys"]:
        bad.append(f"keys where none belong: {run['keys']}")
    # without keys the run IS the only-CLAP path: a difference is the rephrasing's own
    # variance (no LLM cache here), not the profile's doing
    if case.get("group") == "G" and base and run["keys"]:
        overlap = len(set(run["ids"][:TOP]) & set(base[:TOP]))
        if overlap < min(TOP, len(base)) - 2:
            bad.append(f"top-{TOP} differs from only-CLAP: {overlap} in common")
    like = case.get("like")
    if like:
        from musix.assistant.branches.audio import _base_title

        if (
            run["path"] == "agent"
            and profile_run(run)
            and not run.get("title", "").startswith("Похожее на")
        ):
            bad.append(f"not read as «похожее на {like}»: {run.get('title')!r}")
        itself = [
            info[t]["title"]
            for t in run["ids"]
            if t in info and _base_title(info[t]["title"]) == fold(like)
        ]
        if itself:
            bad.append(f"the track itself in the list: {itself}")
    if 2 in tiers and "нашлось" not in run["human"] and "не нашлось" not in run["human"]:
        bad.append("tier 2 added without saying so")
    return bad


def profile_run(run: dict[str, Any]) -> bool:
    """The baseline (only CLAP) cannot read «похожее на» either: only runs with the profile
    are held to it."""
    return bool(run.get("profile", True))


def row(t: dict[str, Any] | None, tier: int | None) -> str:
    if not t:
        return "—"
    p = t.get("profile")
    words = []
    if p is not None:
        words += sorted(p.instruments)
        words += [x for x in (p.pace, p.feel, p.drums) if x]
        words.append(f"odd {p.odd}")
    mark = " ²" if tier == 2 else ""
    sub = f"{t['year'] or ''} · {int(t['secs'])} с · {', '.join(words)}"
    return f"{t['artist']} — {t['title']}{mark} <sub>{sub}</sub>"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True, type=uuid.UUID)
    in_repo = Path(__file__).parents[1] / "server/tests/assistant/sound_queries.yaml"
    beside = Path(__file__).with_name("sound_queries.yaml")
    ap.add_argument("--queries", default=str(in_repo if in_repo.exists() else beside))
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--groups", default="")
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    cases = yaml.safe_load(Path(args.queries).read_text())["queries"]  # noqa: ASYNC240 — once, at start
    if args.groups:
        cases = [c for c in cases if c["group"] in args.groups.split(",")]
    if args.only:
        cases = [c for c in cases if c["id"] in args.only.split(",")]
    env = await setup(args.account)

    print(f"# Эталоны поиска по звуку — {time.strftime('%Y-%m-%d %H:%M')}\n")
    print(f"Аккаунт `{args.account}`, прогонов с профилем: {args.runs}. ² — второй уровень.\n")
    summary = []
    lat_base: list[float] = []
    lat_prof: list[float] = []
    for case in cases:
        base = await turn(env, args.account, case["q"], profile=False)
        lat_base.append(base["secs"])
        runs = []
        for _ in range(args.runs):
            with suppress(Exception):
                runs.append(await turn(env, args.account, case["q"], profile=True))
        lat_prof += [r["secs"] for r in runs]
        ids = {*base["ids"], *(i for r in runs for i in r["ids"])}
        info = await describe(env, args.account, list(ids))
        fails = [checks(case, r, info, base["ids"]) for r in runs]
        parsed = [tuple(sorted(r["keys"])) for r in runs]
        stable = max((parsed.count(p) for p in set(parsed)), default=0)
        ok = all(not f for f in fails) and bool(runs)
        summary.append((case, ok, stable, len(runs)))

        print(f"## {case['id']} · {case['q']}\n")
        print(f"Ждём: `{' '.join(case.get('keys') or []) or '—'}` · {case.get('expect', '')}\n")
        for i, (r, f) in enumerate(zip(runs, fails, strict=True), 1):
            got = " ".join(r["keys"]) or "—"
            print(
                f"- прогон {i}: {r['path']} · {r['intent']} · ключи `{got}` · "
                f"{r['secs']:.1f} с · «{r['human']}»"
            )
            for line in f:
                print(f"  - ✗ {line}")
        if runs:
            print("\n| | только CLAP | CLAP + профиль |\n|---|---|---|")
            first = runs[0]
            tiers = first["tiers"] or [1] * len(first["ids"])
            for i in range(min(TOP, max(len(base["ids"]), len(first["ids"])))):
                a = info.get(base["ids"][i]) if i < len(base["ids"]) else None
                b = info.get(first["ids"][i]) if i < len(first["ids"]) else None
                print(
                    f"| {i + 1} | {row(a, None)} | {row(b, tiers[i] if i < len(tiers) else None)} |"
                )
        print()

    print("## Сводка\n\n| # | запрос | проверки | разбор стабилен |\n|---|---|---|---|")
    for case, ok, stable, n in summary:
        print(f"| {case['id']} | {case['q']} | {'✓' if ok else '✗'} | {stable}/{n} |")
    if lat_base and lat_prof:
        print(
            f"\nЗадержка, медиана: только CLAP {statistics.median(lat_base):.1f} с, "
            f"с профилем {statistics.median(lat_prof):.1f} с."
        )


if __name__ == "__main__":
    asyncio.run(main())
