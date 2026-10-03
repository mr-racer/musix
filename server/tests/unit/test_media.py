from musix.contexts.media.audio import gains
from musix.contexts.media.delivery import choose_tier


def test_tier_follows_the_request_and_the_client() -> None:
    all_ = {"lossless", "high", "economy"}
    assert choose_tier("lossless", all_, "flac", "android") == "lossless"
    assert choose_tier("high", all_, "flac", "android") == "high"
    assert (
        choose_tier("economy", {"lossless", "high"}, "flac", "android") == "high"
    )  # not built yet
    # ALAC: only Windows decodes it (Android played it silent); Dolby/DTS is never as-is
    alac = {"lossless", "high", "lossless_compat"}
    assert choose_tier("lossless", alac, "alac", "web") == "lossless_compat"
    assert choose_tier("lossless", alac, "alac", "android") == "lossless_compat"
    assert choose_tier("lossless", alac, "alac", "windows") == "lossless"
    assert choose_tier("lossless", alac, "eac3", "windows") == "lossless_compat"
    assert choose_tier("lossless", {"lossless", "high"}, "alac", "android") == "high"


def test_gain_attenuates_freely_and_boosts_within_the_headroom() -> None:
    assert gains(-6.0, -0.1) == -3.2  # loud master: attenuate to the library's −9.2
    assert gains(-15.0, -10.0) == 5.8  # quiet with 9 dB of headroom: the full boost
    assert gains(-15.0, -3.0) == 2.0  # capped at −1 dBTP
    assert gains(None, None) is None
