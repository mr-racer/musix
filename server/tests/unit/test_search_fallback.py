"""The web fallback when SearXNG has nothing (its engines are blocked from the prod host)."""

from musix.assistant import web_search
from musix.assistant.resources import searxng_client


def test_ddg_is_asked_even_when_wikipedia_answers(monkeypatch):
    # «Песни из TDU 2», 2026-10-24: Wikipedia's title search always finds some article, so a
    # DDG asked only when everything else was empty never ran, and the playlist was built
    # from Metric's band page. The soundtrack page came from DDG alone.
    fandom = {
        "url": "https://testdrive.fandom.com/wiki/Test_Drive_Unlimited_2/Soundtrack",
        "title": "Soundtrack",
        "content": "",
        "engine": "duckduckgo",
    }
    wiki = {
        "url": "https://en.wikipedia.org/wiki/Metric_(band)",
        "title": "Metric",
        "content": "",
        "engine": "wikipedia",
    }
    monkeypatch.setattr(searxng_client, "search_ddg", lambda q, limit=10: [fandom])
    monkeypatch.setattr(searxng_client, "search_wikipedia", lambda q, limit=10: [wiki])
    monkeypatch.setattr(web_search, "search_bing", lambda q, limit=5: [])

    rows = searxng_client.fallback('"Test Drive Unlimited 2" soundtrack full track list')

    assert [r["url"] for r in rows] == [fandom["url"], wiki["url"]]
