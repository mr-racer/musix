"""«Поток» policy rules and the autoplay order (pure code, no database)."""

import numpy as np

from musix.recsys import autoplay, policy
from musix.recsys.policy import Ctx, Item, Recent


def items(n: int, **kw: object) -> list[Item]:
    base = {"artist": None, "genre": "Rock", "energy": 0.0, "pools": frozenset({"familiar"})}
    return [Item(track=f"t{i}", score=1 - i / 100, **{**base, **kw}) for i in range(n)]  # type: ignore[arg-type]


def ctx(**kw: object) -> Ctx:
    base: dict[str, object] = {
        "shares": {"familiar": 1.0},
        "recent": [],
        "pool_log": [],
        "excluded": set(),
    }
    return Ctx(**{**base, **kw})  # type: ignore[arg-type]


RNG = np.random.default_rng(0)


def test_preset_window_serves_the_pool_with_the_largest_deficit() -> None:
    cands = [
        *items(3, pools=frozenset({"familiar"})),
        Item("u", None, "Rock", 0.0, frozenset({"unplayed"}), 0.1),
        Item("r", None, "Rock", 0.0, frozenset({"rediscover"}), 0.2),
    ]
    shares = {"familiar": 0.5, "unplayed": 0.3, "rediscover": 0.2}
    c = ctx(pool_log=["familiar"] * 6 + ["rediscover"] * 3)
    c.shares = shares
    d = policy.pick(cands, c, RNG)
    assert d is not None
    assert cands[d.index].track == "u"  # unplayed is 3.0 short of its 30 %, the rest are not
    assert d.pool == "unplayed"
    c = ctx(pool_log=[], excluded={"u"})
    c.shares = {"unplayed": 1.0, "familiar": 0.0}
    d = policy.pick(cands, c, RNG)
    assert d is not None
    assert d.pool.startswith("dry:unplayed")  # the only unplayed is excluded: the pool ran dry


def test_artist_rules_and_same_day_exclusion() -> None:
    cands = [
        Item("a1", "A", "Rock", 0.0, frozenset({"familiar"}), 0.9),
        Item("b1", "B", "Rock", 0.0, frozenset({"familiar"}), 0.8),
        Item("c1", "C", "Pop", 0.0, frozenset({"familiar"}), 0.7),
    ]
    recent = [Recent("x", "A", "Rock", False), Recent("y", "Z", "Rock", False)]
    d = policy.pick(cands, ctx(recent=recent), RNG)
    assert d is not None
    assert cands[d.index].track == "b1"  # A was among the last 3
    d = policy.pick(cands, ctx(excluded={"a1", "b1"}), RNG)
    assert d is not None
    assert cands[d.index].track == "c1"  # heard or served today: never again today


def test_genre_fatigue_leaves_the_genre_unless_held() -> None:
    cands = [
        Item("r1", "A", "Rock", 0.0, frozenset({"familiar"}), 0.9),
        Item("p1", "B", "Pop", 0.0, frozenset({"familiar"}), 0.5),
    ]
    run = [Recent(f"x{i}", f"ar{i}", "Rock", False) for i in range(6)]
    vec = {"Rock": np.array([1.0, 0.0]), "Pop": np.array([0.8, 0.6])}
    d = policy.pick(cands, ctx(recent=run, genre_vec=vec, adjacency=0.5), RNG)
    assert d is not None
    assert (cands[d.index].track, d.trigger, d.target_genre) == ("p1", "run", "Pop")
    held = [*run[:-1], Recent("x5", "ar5", "Rock", False, held=True)]  # an «огонёк» holds Rock
    d = policy.pick(cands, ctx(recent=held, genre_vec=vec, adjacency=0.5), RNG)
    assert d is not None
    assert cands[d.index].track == "r1"
    assert d.trigger is None


def test_autoplay_order_keeps_v1_rules() -> None:
    c = [
        ("seed", "A", 200_000),
        ("t1", "A", 200_000),
        ("t2", "A", 200_000),
        ("t3", "A", 200_000),
        ("t4", "B", 200_000),
        ("short", "C", 30_000),
        ("t5", "B", 200_000),
    ]
    got = autoplay.order(c, skip={"seed"}, limit=10)
    assert got[:4] == ["t1", "t2", "t4", "t5"]  # the third A in a row is demoted...
    assert got[-1] == "t3"  # ...to the tail; a track under 60 s never plays
    assert "short" not in got
    assert len(autoplay.order(c, skip=set(), limit=2)) == 2


def test_vibes_form_from_similar_full_listens_and_dissolve_under_water() -> None:
    import datetime as dt

    from musix.recsys.replay import Signal
    from musix.recsys.session import Listen
    from musix.recsys.vibes import vibes

    now = dt.datetime(2026, 9, 30, 12, tzinfo=dt.UTC)
    base, other = np.eye(4)[0], np.eye(4)[1]
    clap = {"a": base, "b": base + 0.05 * other, "c": other, "w": base + 0.01 * other}
    ls = [
        Listen(t, now - dt.timedelta(hours=h), 200_000, 200_000, None, None, "Rock")
        for t, h in (("a", 1), ("b", 2), ("a", 3), ("c", 4))
    ]
    got = vibes(ls, [], clap, now)
    assert [(v.track, sorted(v.members)) for v in got] == [("a", ["a", "b"])]  # «c» stands alone
    one = [Signal("w", now, "water")]
    assert [v.track for v in vibes(ls, one, clap, now)] == ["a"]  # 1.16 − 0.6 still ≥ 0.3
    assert vibes(ls, [*one, Signal("w", now - dt.timedelta(hours=1), "water")], clap, now) == []
