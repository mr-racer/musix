"""The sound profile in the assistant (spec sound-search-profile §4–5): the planner's `sound`
field, the audio branch's tiers and caption, the RRF weights."""

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

from musix.assistant.branches.audio import AudioBranch, _rrf
from musix.assistant.config import AgentConfig
from musix.assistant.contracts import Filters, Plan
from musix.assistant.models import TrackHit, TrackMetadata
from musix.assistant.planner import Planner, validate_sound
from musix.contexts.sound import query as SQ
from musix.contexts.sound.derive import FEAT_NAMES


def ks(found: Any) -> set[tuple[str, bool]]:
    return {(k.key, k.neg) for k in found}


# ---------------------------------------------------------------- planner


def test_sound_keys_must_be_the_users_words() -> None:
    raw = [
        {"key": "guitar", "word": "с гитарой", "neg": False},
        {"key": "calm", "word": "спокойные", "neg": False},  # never said
        {"key": "odd", "word": "экспериментальная"},
        {"key": "jazzy", "word": "песня"},  # not a key
        "garbage",
    ]
    msg = "экспериментальная песня Kanye West с гитарой"
    assert ks(validate_sound(raw, msg)) == {("guitar", False), ("odd", False)}


def test_fame_is_not_a_soft_key() -> None:
    raw = [{"key": "tech", "word": "лучшие"}]
    assert ks(validate_sound(raw, "лучшие песни Queen")) == set()


def test_lexicon_survives_a_broken_field() -> None:
    assert ks(validate_sound(None, "Nickelback без гитары")) == {("guitar", True)}
    assert ks(validate_sound("oops", "что-нибудь с саксофоном")) == {("winds", False)}


def test_a_name_is_not_a_key() -> None:
    raw = [{"key": "piano", "word": "Piano"}]
    assert ks(validate_sound(raw, "включи Piano Man", names=["Piano Man"])) == set()


def _plan(raw: dict[str, Any], message: str) -> Plan | None:
    planner = Planner(llm=None, config=AgentConfig())  # type: ignore[arg-type]
    return planner.validate(raw, message)


def test_planner_keeps_audio_for_sound_keys_alone() -> None:
    plan = _plan({"intent": "audio_search", "artist": "Kanye West"}, "песни Kanye West с гитарой")
    assert plan is not None
    assert plan.intent == "audio_search"
    assert ks(plan.filters.sound) == {("guitar", False)}


def test_lyrics_and_general_take_no_keys() -> None:
    plan = _plan({"intent": "lyrics_search"}, "песня, где поют про гитару")
    assert plan is not None
    assert plan.filters.sound == ()
    plan = _plan({"intent": "general", "artist": "Queen"}, "кто играл на гитаре у Queen")
    assert plan is not None
    assert plan.filters.sound == ()


def test_fame_only_is_still_a_playlist() -> None:
    plan = _plan({"intent": "audio_search", "style": "лучшие"}, "лучшие песни Sade")
    assert plan is not None
    assert plan.intent == "playlist"
    assert plan.filters.sound == ()


def test_one_word_is_one_key() -> None:
    # eval C4: the model read «с духовыми» as brass AND winds — trumpets demanded of all
    raw = [
        {"key": "brass", "word": "с духовыми"},
        {"key": "winds", "word": "с духовыми"},
        {"key": "energetic", "word": "бодрое"},
    ]
    found = ks(validate_sound(raw, "бодрое с духовыми, как на вечеринке"))
    assert found == {("winds", False), ("energetic", False)}
    # a shared «без» is not a shared word
    raw = [{"key": "guitar", "word": "без гитары", "neg": True}]
    found = ks(validate_sound(raw, "без вокала и без гитары"))
    assert found == {("no_vocals", False), ("guitar", True)}


def test_artist_and_sound_alone_is_an_audio_search() -> None:
    # eval B3, D1: playlist in 2 runs of 3, with nothing in the sentence for the web
    for msg, artist in (
        ("Coldplay где есть пианино", "Coldplay"),
        ("Nickelback без гитары", "Nickelback"),
    ):
        plan = _plan({"intent": "playlist", "artist": artist}, msg)
        assert plan is not None
        assert plan.intent == "audio_search", msg
    for msg, artist in (
        ("хиты Coldplay с пианино", "Coldplay"),
        ("песни с участием Jay-Z с гитарой", "Jay-Z"),
        ("альбом Queen с пианино", "Queen"),
    ):
        plan = _plan({"intent": "playlist", "artist": artist}, msg)
        assert plan is not None
        assert plan.intent == "playlist", msg


def test_a_hint_is_not_a_key() -> None:
    # eval D6, D4, K3: hard keys the model read off words that only hint at them
    raw = [{"key": "live_drums", "word": "живым звуком"}]
    msg = "что-нибудь без драм-машины, с живым звуком"
    assert ks(validate_sound(raw, msg)) == {("drum_machine", True)}
    raw = [{"key": "guitar", "word": "электрогитары", "neg": True}]
    assert ks(validate_sound(raw, "рок без электрогитары, что-то акустическое")) == set()
    raw = [
        {"key": "live_drums", "word": "бочка качала"},
        {"key": "bass_heavy", "word": "басы жирные"},
    ]
    assert ks(validate_sound(raw, "чтоб бочка качала и басы жирные")) == {("bass_heavy", False)}
    # eval G1, G2, H5, K6: soft keys from a metaphor
    for word, key, msg in (
        ("тягучее", "calm", "мрачное и тягучее"),
        ("солнечное", "energetic", "летнее настроение, что-то солнечное"),
        ("тяжёлое", "bass_heavy", "тяжёлое, как Royal Blood"),
        ("не скучного", "energetic", "что-то типа инструментала но не скучного"),
    ):
        assert (key, False) not in ks(validate_sound([{"key": key, "word": word}], msg)), word
    # what is said outright stays — the voice in any words, a soft key in transliteration
    raw = [{"key": "no_vocals", "word": "почти не поют"}]
    assert ks(validate_sound(raw, "Linkin Park, где почти не поют")) == {("no_vocals", False)}
    raw = [{"key": "calm", "word": "spokoinye"}]
    found = ks(validate_sound(raw, "spokoinye pesni s gitaroi"))
    assert found == {("calm", False), ("guitar", False)}


def test_fame_with_sound_is_a_playlist() -> None:
    # eval F3: «популярные» needs the web, the sound keys then filter its list
    plan = _plan(
        {"intent": "audio_search", "artist": "Coldplay", "style": "медленные"},
        "популярные медленные песни Coldplay",
    )
    assert plan is not None
    assert plan.intent == "playlist"
    plan = _plan(
        {"intent": "audio_search", "artist": "Sade", "style": "бодрые"}, "самые бодрые песни Sade"
    )
    assert plan is not None
    assert plan.intent == "audio_search"


# ---------------------------------------------------------------- rrf


def test_rrf_weights() -> None:
    assert _rrf([["a", "b"], ["b", "a"]]) == _rrf([["a", "b"], ["b", "a"]], weights=[1, 1])
    merged = dict(_rrf([["a", "b"], ["b", "a"]], weights=[1.0, 3.0]))
    assert merged["b"] > merged["a"]


# ---------------------------------------------------------------- the branch


def _profile(tid: str, **kw: Any) -> SQ.Profile:
    feat = dict.fromkeys(FEAT_NAMES, 0.0) | kw.pop("feat", {})
    row = SimpleNamespace(
        track_id=tid,
        media_file_id=f"mf-{tid}",
        duration_ms=kw.pop("duration_ms", 200_000),
        year=2010,
        instruments=kw.pop("instruments", []),
        traits=[],
        drums=None,
        vocals="voice",
        vocal_share=0.6,
        pace="medium",
        feel=None,
        odd=kw.pop("odd", 20),
        tech=40,
        space=50,
        echo="little",
        width="medium",
        feat=[feat[n] for n in FEAT_NAMES],
    )
    return SQ.Profile.from_row(row)


def _hit(tid: str) -> TrackHit:
    return TrackHit(
        track=TrackMetadata(
            track_id=tid, title=tid, artist="Kanye West", duration_sec=200, file_path=""
        ),
        score=0.0,
        matched_on="audio",
    )


class FakeService:
    def __init__(self, profiles: dict[str, SQ.Profile], clap: list[str]) -> None:
        self.profiles, self.clap = profiles, clap

    async def search(self, query: str, **_: Any) -> list[TrackHit]:
        return [_hit(t) for t in self.clap]

    async def sound_profiles(self, **_: Any) -> dict[str, SQ.Profile]:
        return self.profiles

    async def track_hits(self, mfs: list[str]) -> list[TrackHit]:
        return [_hit(mf.removeprefix("mf-")) for mf in mfs]


class FakeLLM:
    last_raw = ""

    async def ask_list(self, messages: Any) -> list[str]:
        return ["calm guitar", "slow guitar song", "soft acoustic", "mellow"]


class Timings:
    @contextmanager
    def span(self, name: str) -> Any:
        yield


class Sink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def put(self, name: str, **kw: Any) -> None:
        self.events.append((name, kw))


def _agent(service: FakeService) -> Any:
    return SimpleNamespace(
        cfg=AgentConfig(lang="ru"),
        sink=Sink(),
        timings=Timings(),
        search_service=service,
        llm=FakeLLM(),
        collection_name="c",
        library_artist_ref=lambda raw: (raw, "kanye-west" if raw else None),
    )


def _audio_plan(keys: list[SQ.SoundKey], count: int | None = None) -> Plan:
    return Plan(
        intent="audio_search",
        filters=Filters(artist="Kanye West", style="гитара", sound=tuple(keys), count=count),
        web_queries=[],
        ce_query="",
    )


async def test_hard_key_selects_and_soft_key_orders() -> None:
    profiles = {
        "moon": _profile("moon", instruments=["guitar"], odd=64),
        "gorgeous": _profile("gorgeous", instruments=["guitar"], odd=46),
        "skit": _profile("skit", instruments=["guitar"], odd=92, duration_ms=40_000),
        "selfish": _profile("selfish", instruments=["piano"], odd=68),
        "pablo": _profile("pablo", odd=45),
        "real": _profile("real", instruments=["guitar"], odd=50),
        "ghost": _profile("ghost", instruments=["guitar"], odd=55),
    }
    # CLAP liked the piano song best; it has no guitar
    svc = FakeService(profiles, ["selfish", "gorgeous", "pablo"])
    plan = _audio_plan([SQ.SoundKey("guitar"), SQ.SoundKey("odd")], count=4)
    res = await AudioBranch(_agent(svc)).run("экспериментальная Kanye с гитарой", plan)
    ids = [h.track.track_id for h in res.tracks]
    assert set(ids) <= {"moon", "gorgeous", "skit", "real", "ghost"}
    assert res.tiers == [1] * len(ids)
    assert ids.index("moon") < ids.index("real")
    assert "с гитарой, необычные" in res.comment
    assert res.sound_keys == ["guitar", "odd"]


async def test_too_few_is_said_and_filled() -> None:
    profiles = {
        "moon": _profile("moon", instruments=["guitar"]),
        "a": _profile("a"),
        "b": _profile("b"),
        "c": _profile("c"),
    }
    svc = FakeService(profiles, ["a", "b", "moon", "c"])
    plan = _audio_plan([SQ.SoundKey("guitar")], count=4)
    res = await AudioBranch(_agent(svc)).run("Kanye с гитарой", plan)
    ids = [h.track.track_id for h in res.tracks]
    assert ids[0] == "moon"
    assert res.tiers == [1, 2, 2, 2]
    assert "С гитарой у Kanye West нашлось 1" in res.comment


async def test_none_passes() -> None:
    profiles = {
        "a": _profile("a", instruments=["guitar"]),
        "b": _profile("b", instruments=["guitar"]),
    }
    svc = FakeService(profiles, ["a", "b"])
    plan = _audio_plan([SQ.SoundKey("guitar", neg=True)])
    res = await AudioBranch(_agent(svc)).run("Kanye без гитары", plan)
    assert res.tiers == [2, 2]
    assert res.comment.startswith("Треков без гитары у Kanye West не нашлось")


async def test_skits_go_after_the_songs() -> None:
    # eval A7: CLAP put a 40-second «Intro» in the top for «странное»
    profiles = {t: _profile(t, odd=50) for t in ("intro", "a", "b", "c", "d", "e")}
    svc = FakeService(profiles, ["intro", "a", "b", "c", "d", "e"])
    svc.track_hits = None  # type: ignore[assignment]  # every track is already in CLAP's list
    plan = _audio_plan([SQ.SoundKey("odd")], count=6)
    plan.filters.artist = None
    agent = _agent(svc)
    branch = AudioBranch(agent)
    real = svc.search

    async def search(query: str, **kw: Any) -> list[TrackHit]:
        hits = await real(query, **kw)
        for h in hits:
            if h.track.track_id == "intro":
                h.track.duration_sec = 40
        return hits

    svc.search = search  # type: ignore[method-assign]
    res = await branch.run("что-нибудь странное", plan)
    assert [h.track.track_id for h in res.tracks][-1] == "intro"


async def test_an_unresolved_artist_is_the_listeners_word() -> None:
    # eval K7: «Kanye» came back from the catalog as the shortlist's «Kokane», no slug
    profiles = {t: _profile(t, instruments=["guitar"]) for t in ("a", "b", "c", "d", "e")}
    asked: list[dict[str, Any]] = []

    class Svc(FakeService):
        async def sound_profiles(self, **kw: Any) -> dict[str, SQ.Profile]:
            asked.append(kw)
            return self.profiles

    agent = _agent(Svc(profiles, ["a", "b", "c", "d", "e"]))
    agent.library_artist_ref = lambda raw: ("Kokane", None)
    plan = _audio_plan([SQ.SoundKey("guitar")], count=5)
    plan.filters.artist = "Kanye"
    res = await AudioBranch(agent).run("Kanye спокойное гитара эксперимент", plan)
    assert asked[0]["artist_name"] == "Kanye"
    assert len(res.tracks) == 5  # every _hit is by «Kanye West»
    assert "Kokane" not in res.comment


async def test_no_keys_is_the_old_path() -> None:
    svc = FakeService({}, ["a", "b"])
    plan = _audio_plan([])
    res = await AudioBranch(_agent(svc)).run("мрачное", plan)
    assert [h.track.track_id for h in res.tracks] == ["a", "b"]
    assert res.tiers == []
    assert res.sound_keys == []


# ------------------------------------------------- «похожее на <трек>, но …»


def _named(tid: str, title: str, duration: float = 200) -> TrackHit:
    hit = _hit(tid)
    hit.track.title = title
    hit.track.duration_sec = duration
    return hit


class LikeService(FakeService):
    def __init__(
        self, profiles: dict[str, SQ.Profile], near: list[TrackHit], clap: list[str] = ()
    ) -> None:
        super().__init__(profiles, list(clap))
        self.near = near
        self.searched_inside: list[Any] = []

    async def find_track(self, title: str, artist_slug: str | None = None) -> dict | None:
        if title.lower() != "moon":
            return None
        return {
            "track_id": "seed",
            "media_file_id": "mf-seed",
            "title": "Moon",
            "artist": "Kanye West",
        }

    async def neighbours(self, media_file_id: str, limit: int) -> list[tuple[str, TrackHit]]:
        return [(f"mf-{h.track.track_id}", h) for h in self.near[:limit]]

    async def search(self, query: str, **kw: Any) -> list[TrackHit]:
        self.searched_inside.append(kw.get("filters"))
        return await super().search(query, **kw)


def _like_plan(song: str, keys: list[SQ.SoundKey], style: str, count: int = 3) -> Plan:
    return Plan(
        intent="audio_search",
        filters=Filters(song=song, style=style, sound=tuple(keys), count=count),
        web_queries=[],
        ce_query="",
    )


async def test_like_track_selects_among_its_neighbours() -> None:
    near = [
        _named("live", "Moon - Live", 230),  # the seed's own other version
        _named("a", "A"),
        _named("b", "B"),
        _named("c", "C"),
        _named("c2", "C"),  # the same song filed twice
        _named("d", "D"),
        _named("e", "E"),
    ]
    profiles = {
        "a": _profile("a"),
        "b": _profile("b"),
        "c": _profile("c", instruments=["guitar"]),
        "c2": _profile("c2", instruments=["guitar"]),
        "d": _profile("d", instruments=["guitar"]),
        "e": _profile("e", instruments=["guitar"]),
    }
    svc = LikeService(profiles, near)
    plan = _like_plan("Moon", [SQ.SoundKey("guitar", word="гитарой")], "с гитарой")
    res = await AudioBranch(_agent(svc)).run("похожее на Moon, но с гитарой", plan)
    ids = [h.track.track_id for h in res.tracks]
    assert ids == ["c", "d", "e"]  # the neighbours' order, guitar only, one «C»
    assert res.tiers == [1, 1, 1]
    assert res.title.startswith("Похожее на «Moon»")
    assert "«Moon» (Kanye West)" in res.comment
    assert svc.searched_inside == []  # nothing left of the style for CLAP


async def test_like_track_fills_and_says_so() -> None:
    near = [_named(t, t.upper()) for t in ("a", "b", "c", "d")]
    profiles = {t: _profile(t) for t in ("a", "b", "c", "d")} | {
        "c": _profile("c", instruments=["guitar"])
    }
    svc = LikeService(profiles, near)
    plan = _like_plan("Moon", [SQ.SoundKey("guitar")], "с гитарой", count=4)
    res = await AudioBranch(_agent(svc)).run("как Moon, только с гитарой", plan)
    assert res.tracks[0].track.track_id == "c"
    assert res.tiers == [1, 2, 2, 2]
    assert "нашлось 1" in res.comment


async def test_like_track_prompts_score_only_the_neighbours() -> None:
    near = [_named(t, t.upper()) for t in ("a", "b", "c")]
    # CLAP «loves» a track outside the neighbours: it must not come in
    svc = LikeService({}, near, clap=["outsider", "c"])
    plan = _like_plan("Moon", [], "мрачнее")
    res = await AudioBranch(_agent(svc)).run("похожее на Moon, но мрачнее", plan)
    ids = [h.track.track_id for h in res.tracks]
    assert "outsider" not in ids
    assert ids[0] == "c"  # neighbours' order and the prompts agree on nothing else
    assert all(f.point_ids == ["mf-a", "mf-b", "mf-c"] for f in svc.searched_inside)


async def test_like_track_unknown_title_is_a_plain_description() -> None:
    profiles = {"g": _profile("g", instruments=["guitar"]), "x": _profile("x")}
    svc = LikeService(profiles, [], clap=["x", "g"])
    plan = _like_plan("Sun", [SQ.SoundKey("guitar")], "с гитарой")
    res = await AudioBranch(_agent(svc)).run("похожее на Sun, но с гитарой", plan)
    assert res.tracks[0].track.track_id == "g"  # the profile path took it
    assert not res.title.startswith("Похожее на")


async def test_like_track_title_must_be_in_the_message() -> None:
    near = [_named("a", "A")]
    svc = LikeService({}, near, clap=["z"])
    plan = _like_plan("Moon", [], "спокойное")  # the planner made «Moon» up
    res = await AudioBranch(_agent(svc)).run("что-нибудь спокойное", plan)
    assert [h.track.track_id for h in res.tracks] == ["z"]
