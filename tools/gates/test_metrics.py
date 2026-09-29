from metrics import tie_aware


def test_ties_are_split_evenly_at_the_top() -> None:
    # RRF ties (1/2 from the dense list = 1/2 from BM25) are ordered arbitrarily by Qdrant
    assert tie_aware("a", [["a", 0.5], ["b", 0.5], ["c", 0.3]]) == (0.5, (1 + 1 / 2) / 2)
    assert tie_aware("a", [["b", 0.9], ["a", 0.5]]) == (0.0, 0.5)
    assert tie_aware("x", [["a", 0.5]]) is None
