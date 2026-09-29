from musix.contexts.media.audio import gains
from musix.contexts.media.delivery import choose_tier


def test_tier_follows_the_request_and_the_client() -> None:
    all_ = {"lossless", "high", "economy"}
    assert choose_tier("lossless", all_, "flac", "android") == "lossless"
    assert choose_tier("high", all_, "flac", "android") == "high"
    assert (
        choose_tier("economy", {"lossless", "high"}, "flac", "android") == "high"
    )  # not built yet
    # ALAC: the web cannot decode it, Android can; Dolby/DTS is never served as-is
    alac = {"lossless", "high", "lossless_compat"}
    assert choose_tier("lossless", alac, "alac", "web") == "lossless_compat"
    assert choose_tier("lossless", alac, "alac", "android") == "lossless"
    assert choose_tier("lossless", alac, "eac3", "android") == "lossless_compat"


def test_gain_attenuates_freely_and_boosts_within_the_headroom() -> None:
    assert gains(-8.0, -0.1) == -6.0  # loud master: attenuate to −14
    assert gains(-20.0, -10.0) == 6.0  # quiet with 9 dB of headroom: the full boost
    assert gains(-20.0, -3.0) == 2.0  # capped at −1 dBTP
    assert gains(None, None) is None
