import random

from musix.contexts.playlists.fractional import key_between, keys_between


def test_keys_stay_ordered_through_random_inserts() -> None:
    rnd = random.Random(7)
    keys: list[str] = []
    for _ in range(1000):
        i = rnd.randint(0, len(keys))
        keys.insert(i, key_between(keys[i - 1] if i else None, keys[i] if i < len(keys) else None))
    assert keys == sorted(keys)
    assert len(set(keys)) == 1000
    bulk = keys_between(keys[10], keys[11], 50)
    assert [keys[10], *bulk, keys[11]] == sorted([keys[10], *bulk, keys[11]])
    appended = [key_between(None, None)]
    for _ in range(999):
        appended.append(key_between(appended[-1], None))
    assert max(map(len, appended)) <= 3  # appends step the integer part, not the fraction
