"""The home's album picks (v1's rail, ported) and the sky's weather kinds."""

import uuid

from musix.contexts.screens import picks, weather


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


def test_round_robin_places_every_vibes_best_before_any_second() -> None:
    a, b, c, d, e = _ids(5)
    ranked = [[(0.9, a), (0.8, b)], [(0.7, c), (0.6, d)], [(0.5, e)]]
    out = picks.round_robin(ranked)
    assert [x[1] for x in out] == [a, c, e, b, d]
    assert [x[0] for x in out] == [0, 1, 2, 0, 1]


def test_round_robin_skips_an_album_two_vibes_share_and_caps_the_rail() -> None:
    shared, *rest = _ids(9)
    ranked = [
        [(0.9, shared), (0.8, rest[0]), (0.7, rest[1])],
        [(0.9, shared), (0.8, rest[2]), (0.7, rest[3])],
        [(0.9, rest[4]), (0.8, rest[5]), (0.7, rest[6])],
        [(0.9, rest[7])],
    ]
    out = picks.round_robin(ranked)
    albums = [x[1] for x in out]
    assert albums.count(shared) == 1
    assert len(out) == picks.TOTAL_MAX
    assert all(sum(1 for x in out if x[0] == vi) <= picks.MAX_PER_VIBE for vi in range(4))
    assert albums[:4] == [shared, rest[2], rest[4], rest[7]]  # each vibe's best first


def test_round_robin_with_empty_vibes() -> None:
    assert picks.round_robin([]) == []
    assert picks.round_robin([[], []]) == []


def test_weather_kinds_follow_wmo_codes() -> None:
    assert [weather.kind_of(c) for c in (0, 1)] == ["clear", "clear"]
    assert [weather.kind_of(c) for c in (2, 3, 45)] == ["cloudy"] * 3
    assert [weather.kind_of(c) for c in (61, 80, 95)] == ["rain"] * 3
    assert [weather.kind_of(c) for c in (71, 85)] == ["snow", "snow"]
