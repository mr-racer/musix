"""The gatefold's credits: producers summed over an album, the web's noise left out."""

from musix.contexts.screens.service import clean_credits


def test_the_artist_themself_their_name_parts_and_youtubers_are_not_producers() -> None:
    rows = [
        ("producer", "Kanye West", None, 12),
        ("label", "G.O.O.D. Music, Roc-A-Fella Records & Def Jam Recordings", None, 7),
        ("producer", "MIKE DEAN", "01a0f21a-0000-7000-8000-000000000001", 8),
        ("producer", "West", None, 3),
        ("producer", "Jeff Bhasker", None, 5),
        ("producer", "Yz (Youtuber)", None, 2),
        ("producer", "No I.D.", None, 1),
        ("producer", "Someone Once", None, 1),
    ]
    producers, label = clean_credits(rows, "Kanye West")
    assert [p.name for p in producers] == ["MIKE DEAN", "Jeff Bhasker"]
    assert producers[0].artist_id is not None
    assert producers[0].songs == 8
    assert label == "G.O.O.D. Music"


def test_nothing_known_gives_nothing() -> None:
    assert clean_credits([], "Madonna") == ([], None)
