"""The assistant's speed work (2026-11-12): one search wave per round with an early
stop and two deadlines, triage + curation in one call, hedged search roads, JSON
mode with a fallback, and turns that run side by side."""

import asyncio
import time
from types import SimpleNamespace

from musix.assistant import data
from musix.assistant import llm as llm_mod
from musix.assistant.branches.base import WebBranch
from musix.assistant.config import AgentConfig
from musix.assistant.contracts import Filters, Page, Plan, ResolvedTrack, SearchHit
from musix.assistant.events import AgentSink
from musix.assistant.resources import searxng_client
from musix.assistant.selection import select_and_curate
from musix.assistant.timing import Timings


def _hit(url: str, source: str = "wikipedia") -> SearchHit:
    return SearchHit(url=url, title=url, snippet="", source=source, rank=0)  # type: ignore[arg-type]


class _Sources:
    """Each source sleeps its own delay (seconds) on the worker thread, then answers."""

    def __init__(self, delays: dict, hits: dict) -> None:
        self.delays, self.hits = delays, hits

    def _answer(self, name: str) -> list:
        time.sleep(self.delays.get(name, 0.0))
        return list(self.hits.get(name, []))

    def apple_music(self, q):
        return self._answer("apple")

    def fandom(self, q):
        return self._answer("fandom")

    def wikipedia(self, q, limit=2, force=False):
        return self._answer("wikipedia")

    def web(self, q):
        return self._answer("web")


class _Fetcher:
    async def fetch_many(self, hits, *, limit=None):
        return [Page(url=h.url, title=h.title, markdown="table", source=h.source) for h in hits]


def _branch(sources, **cfg) -> WebBranch:
    agent = SimpleNamespace(cfg=AgentConfig(**cfg), sink=AgentSink(), timings=Timings(), hub=None)
    return WebBranch(agent, sources, _Fetcher())


def _plan() -> Plan:
    return Plan(intent="playlist", filters=Filters(), web_queries=["q"], ce_query="q")


async def test_a_round_stops_once_the_tables_are_enough() -> None:
    # GTA V, 2026-11: Apple had 59 tracks, and the turn still waited ~50 s for the
    # open web and Wikipedia before reading them.
    src = _Sources(
        {"apple": 0.05, "wikipedia": 3.0, "web": 3.0},
        {"apple": [_hit("https://music.apple.com/album/1", "apple")], "wikipedia": [_hit("w")]},
    )
    branch = _branch(src)
    stop = asyncio.Event()

    async def enough(pages):
        stop.set()

    t0 = time.monotonic()
    structured, prose = await branch.gather(
        _plan(), ["q"], "q", structured=True, on_structured=enough, stop=stop
    )
    assert time.monotonic() - t0 < 1.5
    assert [p.url for p in structured] == ["https://music.apple.com/album/1"]
    assert prose == []


async def test_the_soft_deadline_drops_slow_searches_once_something_was_read() -> None:
    src = _Sources(
        {"apple": 0.05, "wikipedia": 3.0, "web": 0.05},
        {"apple": [_hit("a", "apple")], "wikipedia": [_hit("w")]},
    )
    branch = _branch(src, search_soft_deadline=0.4, search_hard_deadline=5.0)
    t0 = time.monotonic()
    structured, _ = await branch.gather(_plan(), ["q"], "q", structured=True)
    assert time.monotonic() - t0 < 1.5
    assert [p.url for p in structured] == ["a"]


async def test_apple_is_waited_for_past_the_soft_deadline() -> None:
    src = _Sources(
        {"apple": 1.0, "wikipedia": 0.05, "web": 0.05},
        {"apple": [_hit("a", "apple")], "wikipedia": [_hit("w")]},
    )
    branch = _branch(src, search_soft_deadline=0.2, search_hard_deadline=5.0)
    structured, _ = await branch.gather(_plan(), ["q"], "q", structured=True)
    assert sorted(p.url for p in structured) == ["a", "w"]


async def test_with_nothing_read_the_round_waits_past_the_soft_deadline() -> None:
    src = _Sources({"apple": 0.6, "wikipedia": 0.6, "web": 0.0}, {"wikipedia": [_hit("w")]})
    branch = _branch(src, search_soft_deadline=0.1, search_hard_deadline=5.0)
    structured, _ = await branch.gather(_plan(), ["q"], "q", structured=True)
    assert [p.url for p in structured] == ["w"]


def _track(i: int) -> ResolvedTrack:
    return ResolvedTrack(
        track_id=f"id{i}", title=f"Song {i}", artist="A", year=None, match="exact", weight=1.0
    )


class _Llm:
    def __init__(self, reply):
        self.reply, self.calls = reply, 0

    async def ask_json(self, messages, **kw):
        self.calls += 1
        return self.reply


async def test_select_and_curate_is_one_call_and_keeps_rank_order_and_cap() -> None:
    tracks = [_track(i) for i in range(1, 13)]
    model = _Llm(
        {
            "keep": ["T5", "T1", "T2", "T99", "T3"],
            "dropped_because": "sidebar",
            "title": "Плейлист",
            "comment": "Одно предложение.",
            "order": [{"id": "T3", "reason": ""}, {"id": "T5", "reason": "x"}, {"id": "T1"}],
        }
    )
    title, comment, out = await select_and_curate(
        model, "хиты", tracks, cap=3, config=AgentConfig(lang="ru")
    )
    assert model.calls == 1
    assert (title, comment) == ("Плейлист", "Одно предложение.")
    # kept in RANK order (T1, T2, T3) and cut to the cap; T5 lost to the cap, T99 never
    # offered; then the model's order among the kept, the unordered rest at the end
    assert [t.track_id for t in out] == ["id3", "id1", "id2"]


async def test_an_empty_keep_is_a_format_slip_not_an_empty_playlist() -> None:
    tracks = [_track(i) for i in range(1, 10)]
    model = _Llm({"keep": [], "order": [], "title": "", "comment": ""})
    _, _, out = await select_and_curate(model, "q", tracks, cap=5, config=AgentConfig())
    assert [t.track_id for t in out] == [f"id{i}" for i in range(1, 6)]


def test_the_hedge_takes_whichever_road_answers_first() -> None:
    def slow():
        time.sleep(1.5)
        return ["slow"]

    t0 = time.monotonic()
    i, got = searxng_client._first_ok([slow, lambda: ["fast"]], after=0.1, deadline=3)
    assert (i, got) == (1, ["fast"])
    assert time.monotonic() - t0 < 1.0


def test_a_failed_road_hands_over_at_once() -> None:
    def boom():
        raise OSError("Network is unreachable")

    t0 = time.monotonic()
    i, got = searxng_client._first_ok([boom, lambda: ["ok"]], after=5, deadline=6)
    assert (i, got) == (1, ["ok"])
    assert time.monotonic() - t0 < 1.0


async def test_json_mode_falls_back_when_the_endpoint_refuses_it(monkeypatch) -> None:
    from musix.assistant import compat
    from musix.infra.llm import LlmRejected

    seen = []

    class Fake:
        async def chat(self, messages, extra_body=None, **kw):
            seen.append(extra_body)
            if extra_body and "response_format" in extra_body:
                raise LlmRejected("LLM: HTTP 400")
            return '{"a": 1}'

    monkeypatch.setattr(compat, "get_llm", lambda: Fake())
    monkeypatch.setattr(llm_mod, "_json_mode_ok", True)
    client = llm_mod.LLMClient(AgentConfig())
    assert await client.ask_json([{"role": "user", "content": "x"}], required=("a",)) == {"a": 1}
    assert await client.ask_json([{"role": "user", "content": "y"}], required=("a",)) == {"a": 1}
    # refused once, then never asked with it again by this process
    assert seen == [llm_mod.JSON_BODY, None, None]


def test_connections_close_with_the_last_running_turn(monkeypatch) -> None:
    closed = []
    monkeypatch.setattr(data, "close_all", lambda: closed.append(1))
    monkeypatch.setattr(data, "_turns", 0)
    data.turn_started()
    data.turn_started()
    data.turn_finished()
    assert closed == []
    data.turn_finished()
    assert closed == [1]


def test_site_queries_skip_searxng_and_take_the_pinned_road(monkeypatch) -> None:
    from musix.assistant import web_sources

    asked = []
    row = {
        "url": "https://music.apple.com/us/album/the-music-of-gta-v/1",
        "title": "The Music of GTA V",
        "content": "",
        "engine": "duckduckgo",
    }
    monkeypatch.setattr(
        searxng_client, "search_pinned", lambda q, limit=10: asked.append(q) or [row]
    )
    monkeypatch.setattr(
        searxng_client,
        "query",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("SearXNG asked")),
    )
    monkeypatch.setattr(web_sources, "_cache_get", lambda key: None)
    monkeypatch.setattr(web_sources, "_cache_put", lambda *a: None)
    cfg = AgentConfig()
    hits = web_sources.SearchSources(cfg, AgentSink()).apple_music("gta v soundtrack")
    assert asked == ["site:music.apple.com gta v soundtrack"]
    assert [h.url for h in hits] == [row["url"]]
