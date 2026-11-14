"""Serper.dev as the first search road, SearXNG and the direct fallbacks behind it."""

import httpx
import pytest

from musix.assistant import web_sources
from musix.assistant.config import AgentConfig
from musix.assistant.events import AgentSink
from musix.assistant.resources import searxng_client, serper_client


class _Resp:
    def __init__(self, status: int, payload=None, text: str = "") -> None:
        self.status_code, self._payload, self.text = status, payload, text

    def json(self):
        return self._payload


ORGANIC = {
    "organic": [
        {
            "link": "https://en.wikipedia.org/wiki/Music_of_Grand_Theft_Auto_V",
            "title": "Music of GTA V",
            "snippet": "s",
        },
        {
            "link": "https://music.apple.com/us/album/the-music-of-gta-v/1",
            "title": "The Music of GTA V",
            "snippet": "",
        },
    ]
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    from musix.assistant import compat

    monkeypatch.setenv("MUSIX_SERPER_API_KEY", "test-key")
    # outside a turn outbound() is a no-op: no loop or sessionmaker bound
    monkeypatch.setattr(compat, "_loop", None)
    monkeypatch.setattr(compat, "_sm", None)
    monkeypatch.setattr(
        serper_client, "_state", {"until": 0.0, "checked": 1e18, "shared_open": False}
    )
    monkeypatch.setattr(serper_client, "_road", {"proxy": False, "until": 0.0})
    monkeypatch.setattr(
        serper_client, "_rest", lambda s, why: serper_client._state.update(until=1e18)
    )
    monkeypatch.setattr(web_sources, "_cache_get", lambda key: None)
    monkeypatch.setattr(web_sources, "_cache_put", lambda *a: None)
    monkeypatch.setattr(web_sources, "_searx_resting", lambda: False)
    monkeypatch.setattr(web_sources, "_searx_outcome", lambda ok: None)


def _sources() -> web_sources.SearchSources:
    return web_sources.SearchSources(AgentConfig(), AgentSink())


def test_serper_answers_first_and_searxng_is_not_asked(monkeypatch) -> None:
    sent = []
    monkeypatch.setattr(
        serper_client, "_post", lambda body, proxy: sent.append(body) or _Resp(200, ORGANIC)
    )
    monkeypatch.setattr(searxng_client, "query", lambda *a, **k: pytest.fail("SearXNG asked"))
    hits = _sources().web("gta v soundtrack")
    assert [h.url for h in hits][:1] == [
        "https://en.wikipedia.org/wiki/Music_of_Grand_Theft_Auto_V"
    ]
    assert sent[0]["q"] == "gta v soundtrack"
    assert sent[0]["gl"] == "us"
    assert sent[0]["num"] <= 10


def test_wikipedia_and_russian_queries_are_pinned_and_localised(monkeypatch) -> None:
    sent = []
    monkeypatch.setattr(
        serper_client, "_post", lambda body, proxy: sent.append(body) or _Resp(200, ORGANIC)
    )
    _sources().wikipedia("саундтрек ведьмака")
    assert sent[0]["q"] == "site:ru.wikipedia.org саундтрек ведьмака"
    assert (sent[0]["gl"], sent[0]["hl"]) == ("ru", "ru")


def test_out_of_credits_rests_serper_and_falls_back_to_searxng(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(
        serper_client,
        "_post",
        lambda body, proxy: (
            calls.append(1) or _Resp(400, text='{"message":"Not enough credits","statusCode":400}')
        ),
    )
    row = {"url": "https://example.org/gta", "title": "GTA", "content": "", "engine": "bing"}
    monkeypatch.setattr(searxng_client, "query", lambda *a, **k: {"results": [row]})
    src = _sources()
    assert [h.url for h in src.web("gta v soundtrack")] == [row["url"]]
    assert [h.url for h in src.web("gta iv soundtrack")] == [row["url"]]
    assert calls == [1]  # resting after the refusal: the second query never paid for a try
    assert not serper_client.available()


def test_without_a_key_serper_is_never_asked(monkeypatch) -> None:
    monkeypatch.delenv("MUSIX_SERPER_API_KEY")
    monkeypatch.setattr(serper_client, "_post", lambda *a: pytest.fail("Serper asked"))
    assert serper_client.search("q") is None


def test_a_dropped_direct_road_retries_once_through_the_proxy(monkeypatch) -> None:
    from musix.assistant import compat

    monkeypatch.setattr(compat, "get_proxy_url", lambda: "http://proxy:1")
    roads = []

    def post(body, proxy):
        roads.append(proxy)
        if proxy is None:
            raise httpx.ConnectError("Network is unreachable")
        return _Resp(200, ORGANIC)

    monkeypatch.setattr(serper_client, "_post", post)
    assert len(serper_client.search("q")) == 2
    assert serper_client.search("q2")
    assert roads == [None, "http://proxy:1", "http://proxy:1"]  # the proxy is remembered


def test_a_server_error_skips_one_query_without_resting(monkeypatch) -> None:
    monkeypatch.setattr(serper_client, "_post", lambda body, proxy: _Resp(502, text="bad gateway"))
    assert serper_client.search("q") is None
    assert serper_client.available()
