import asyncio

from musix.assistant.config import AgentConfig
from musix.assistant.tracklists import TrackExtractor, parse_extract_rows


def test_parse_compact_rows():
    rows = parse_extract_rows('{"t": [["Sleepwalking", "The Chain Gang of 1974", 2014, 2], ["California", null, null, 1]]}')
    assert rows == [("Sleepwalking", "The Chain Gang of 1974", 2014, 2), ("California", None, None, 1)]


def test_parse_truncated_reply_keeps_complete_rows():
    text = '{"t": [["A", "X", 1999, 1], ["B", null, null, 2], ["C", "Y'
    assert [r[0] for r in parse_extract_rows(text)] == ["A", "B"]


def test_parse_legacy_object_shape():
    rows = parse_extract_rows('{"tracks": [{"title": "Love Is a Battlefield", "artist": "Pat Benatar", "year": 1983}]}')
    assert rows[0][:3] == ("Love Is a Battlefield", "Pat Benatar", 1983)


def test_parse_truncated_legacy_objects():
    text = '{"tracks": [{"title": "A", "artist": null, "year": null}, {"title": "B", "artist": "Z", "year": 2001}, {"title": "C"'
    assert [r[0] for r in parse_extract_rows(text)] == ["A", "B"]


class FakeLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def chat(self, messages, **kw):
        self.calls.append((messages, kw))
        return self.replies.pop(0)


def test_batches_run_sequentially_and_stop_when_enough():
    llm = FakeLLM([
        '{"t": [["A", "X", null, 1], ["B", "X", null, 3]]}',
        '{"t": [["C", "X", null, 1]]}',
        '{"t": [["D", "X", null, 1]]}',
    ])
    cfg = AgentConfig()
    cfg.extract_batch_passages = 3
    passages = [(f"https://p{i}", f"text {i}") for i in range(9)]

    async def enough(found):
        return len(found) >= 3

    out = asyncio.run(TrackExtractor(llm, cfg).from_passages(passages, request="r", enough=enough))
    assert [t.title for t in out] == ["A", "B", "C"]
    assert len(llm.calls) == 2
    assert out[1].source_url == "https://p2"  # passage number maps to its own URL
    assert llm.calls[0][1]["max_tokens"] == cfg.extract_max_tokens
    assert "{limit}" not in llm.calls[0][0][0]["content"]


def test_cap_limits_claims_and_batches():
    llm = FakeLLM(['{"t": [["A", null, null, 1], ["B", null, null, 1], ["C", null, null, 1]]}'] * 3)
    cfg = AgentConfig()
    cfg.extract_batch_passages = 1
    cfg.extract_max_claims = 2
    out = asyncio.run(TrackExtractor(llm, cfg).from_passages([("u1", "a"), ("u2", "b")], request="r"))
    assert [t.title for t in out] == ["A", "B"]
    assert len(llm.calls) == 1
