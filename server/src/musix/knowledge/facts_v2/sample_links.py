"""Clean and verify extracted sampling links.

An LLM reading prose produces `dst_artist` + `dst_title` pairs that are mostly
right and sometimes are a TV show, an album, a misspelling, or the same link
written two ways. Production shows all four in 22 rows:

    Pete Rock & CL Smooth  — Mecca and the Soul Brother   ← an ALBUM
    Pete Rock and CL Smooth — The Basement                ← same artist, other spelling
    Rogers and Hammerstein — The Carousel Waltz           ← Rodgers, misspelt
    Dr. Hans Jenny         — None                         ← no title at all
    The Jamie Foxx Show    — The Jamie Foxx Show          ← a TV show

The checks run cheapest-first and each one is allowed to be the last word:

  0. shape     — free, deterministic, rejects the impossible
  1. evidence  — free, both names must occur in the fact the link came from
  2. library   — free, and PROOF when it hits: the recording is in the user's files
  3. corroboration — free, the same link extracted for several different tracks
  4. musicbrainz  — one HTTP call, the only check that can tell a song from an
                    album for a recording nobody in the library owns

Verdicts are cached in ``sample_link_verdicts`` rather than in the process:
MusicBrainz answers about one request a second (their limit is a per-IP budget,
`x-ratelimit-limit: 1200`, not a cadence), so a full pass over the corpus costs
30-60 minutes and must not be paid twice — and an incremental run after new
tracks arrive should cost only the new links.
"""

from __future__ import annotations

import difflib
import re

MB_MIN_INTERVAL = 0.4  # musicbrainzngs paces the calls itself
MB_GOOD_SCORE = 88  # their own 0-100 match score
MB_TIMEOUT = 15.0  # urllib has none by default; a stall hangs forever

# Not recordings. A sampling link whose "song" is one of these is a parse error,
# not a discovery.
_NOT_A_SONG = re.compile(
    r"(?i)\b(the .* show|tv series|television|soundtrack|episode|podcast|"
    r"documentary|commercial|advert|trailer|movie|film)\b"
)

_STRIP = " \t\n\r\"'“”«»‘’.,;:!?()[]"
_FEAT = re.compile(r"(?i)\s*[\(\[]?\s*(feat\.?|ft\.?|featuring|with)\s+.*$")
_PAREN = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]\s*$")


def norm(text: str, *, drop_feat: bool = True) -> str:
    """Comparison key. Display keeps the original spelling."""
    t = (text or "").strip(_STRIP).lower()
    if drop_feat:
        t = _FEAT.sub("", t)
    t = _PAREN.sub("", t)
    t = t.replace("&", " and ")
    t = re.sub(r"[^a-z0-9а-яё]+", " ", t)
    t = re.sub(r"^(the|a|an)\s+", "", t).strip()
    return re.sub(r"\s+", " ", t)


def db_key(artist: str, title: str) -> str:
    """Identity of the other side, as stored in ``sample_links.dst_key``."""
    return f"{norm(artist)}|{norm(title)}"


def to_db_row(link: dict) -> dict:
    """One cleaned link in the shape ``replace_sample_links`` inserts.

    Shared by both writers — the extraction and the verification lane — so the
    same link cannot end up stored under two different ``dst_key`` spellings
    depending on which of them wrote it last.
    """
    return {
        "direction": link["direction"],
        "dst_key": db_key(link.get("artist") or "", link.get("title") or ""),
        "dst_title": link.get("title"),
        "dst_artist": link.get("artist"),
        "dst_slug": link.get("dst_slug"),
        "relation": link.get("relation") or "sample",
        "src_year": link.get("src_year"),
        "dst_year": link.get("dst_year"),
        "evidence": (link.get("fact") or "")[:400] or None,
        "confidence": link.get("confidence"),
    }


def shape_reject(link: dict, src_artist: str, src_title: str) -> str | None:
    """Reasons a link cannot be right, whatever the world says."""
    a, t = (link.get("artist") or "").strip(), (link.get("title") or "").strip()
    if not a or not t:
        return "empty_side"
    na, nt = norm(a), norm(t)
    if not na or not nt:
        return "empty_after_norm"
    if na == nt:
        return "artist_equals_title"  # "The Jamie Foxx Show — The Jamie Foxx Show"
    if _NOT_A_SONG.search(a) or _NOT_A_SONG.search(t):
        return "not_a_recording"
    if nt == norm(src_title) and na == norm(src_artist):
        return "self_reference"
    if len(nt) < 2 or len(na) < 2:
        return "too_short"
    if link.get("direction") not in ("source", "usage"):
        return "bad_direction"
    if link.get("relation") not in ("sample", "interpolation"):
        return "bad_relation"
    return None


def evidence_ok(link: dict, fact_text: str) -> bool:
    """Both sides must actually occur in the prose the link was read from.

    Cheap anti-invention, the same idea as the fact pipeline's name check —
    and it is the only check that catches a plausible-looking pair the model
    assembled out of thin air.
    """
    hay = norm(fact_text, drop_feat=False)
    for side in ("artist", "title"):
        needle = norm(link.get(side) or "")
        if not needle:
            return False
        if needle in hay:
            continue
        # a long title may be quoted with different punctuation; allow a close
        # match against any window of the same length
        if difflib.SequenceMatcher(None, needle, hay).find_longest_match(
            0, len(needle), 0, len(hay)
        ).size >= max(4, len(needle) * 0.8):
            continue
        return False
    return True


def _better_form(a: dict, b: dict) -> bool:
    """Which spelling of the same link survives the merge.

    What decides is EVIDENCE, not shape: a link the library or MusicBrainz
    confirmed beats one nobody could confirm. Length was tried first and got it
    backwards — "The Supreme — You Can't Hurry Love" is longer than
    "The Supremes — Can't Hurry Love" and is the misspelling.
    """
    ka = (RANK.get(a.get("reason", ""), 0), a.get("verbatim", False), -len(a["artist"]))
    kb = (RANK.get(b.get("reason", ""), 0), b.get("verbatim", False), -len(b["artist"]))
    return ka >= kb


def exact_dedupe(links: list) -> list:
    """Collapse identical normalised keys — "Pete Rock & CL Smooth" and
    "Pete Rock and CL Smooth" are one link. Free, and it cuts MB calls."""
    groups: dict = {}
    for lk in links:
        groups.setdefault((norm(lk["artist"]), norm(lk["title"]), lk["direction"]), []).append(lk)
    out = []
    for items in groups.values():
        best = max(
            items, key=lambda x: (x.get("verbatim", False), len(x["artist"]), len(x["title"]))
        )
        best["n_sources"] = len(items)
        out.append(best)
    return out


def fuzzy_merge(links: list) -> list:
    """Second pass: near-identical links that survived the exact pass."""
    out: list = []
    for lk in sorted(links, key=lambda x: -x.get("n_sources", 1)):
        twin = None
        for kept in out:
            if kept["direction"] != lk["direction"]:
                continue
            # Fuzzy on BOTH sides, and one of them has to be nearly exact. The
            # first run left "The Supreme — You Can't Hurry Love" beside
            # "The Supremes — Can't Hurry Love": requiring an identical title key
            # missed it, because a dropped "You" changes the key.
            ar = difflib.SequenceMatcher(None, norm(kept["artist"]), norm(lk["artist"])).ratio()
            tr = difflib.SequenceMatcher(None, norm(kept["title"]), norm(lk["title"])).ratio()
            if ar >= 0.85 and tr >= 0.80 and max(ar, tr) >= 0.9:
                twin = kept
                break
        if twin is None:
            out.append(lk)
            continue
        # Which spelling survives matters: the first run merged the correct
        # "The Supremes" INTO the misspelt "The Supreme", because the survivor
        # was whichever happened to be seen first. Pick deliberately.
        keep, drop = (twin, lk) if _better_form(twin, lk) else (lk, twin)
        if keep is lk:
            out[out.index(twin)] = lk
        keep["n_sources"] = twin.get("n_sources", 1) + lk.get("n_sources", 1)
        keep.setdefault("merged_from", []).append(f"{drop['artist']} — {drop['title']}")
    return out


# ── the one external check ───────────────────────────────────────────────────


def _side_matches(asked: str, got: str) -> float:
    """How well one side of the pair lines up with what MusicBrainz returned.

    A plain string ratio is too strict on both sides, and the first run showed
    exactly how:

      asked  Julius Fučík
      got    Julius Fučík Arturo Rodríguez Budapest Art Orchestra   ratio 0.35
      asked  What Will Santa Say?
      got    What Will Santa Say? (When He Finds Everyone Swingin')  ratio 0.55

    Both are the right recording. MusicBrainz credits every performer on a
    recording and disambiguates titles with a parenthetical, so what we want is
    CONTAINMENT — did the thing we asked for survive inside the answer.
    """
    a, b = norm(asked), norm(got)
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _mb_verified(cand: dict) -> bool:
    """MusicBrainz scores the QUERY, not the pair — a query naming an album still
    matches some recording — so the score never decides alone.

    Two ways to pass: a high score with both sides lining up, or both sides
    lining up almost exactly at a lower score. The second is what admits
    "Entrance of the Gladiators" → "Entry of the Gladiators" (score 72, the
    right recording under its variant title)."""
    a, t, sc = (cand.get("artist_ratio", 0), cand.get("title_ratio", 0), cand.get("score", 0))
    return bool(
        (sc >= MB_GOOD_SCORE and a >= 0.75 and t >= 0.75) or (a >= 0.9 and t >= 0.9 and sc >= 65)
    )


# ── library resolution ───────────────────────────────────────────────────────

# v2: the resolver is built by the runner from Postgres (contexts/knowledge/jobs.py),
# and MusicBrainz is asked by the queue task `knowledge:verify` through the shared
# bucket (v1's in-process client is gone; its scoring helpers above are what it reuses).


# ── driver ───────────────────────────────────────────────────────────────────

RANK = {"in_library": 4, "musicbrainz": 3, "corroborated": 2, "": 0}


def clean(links: list, *, resolve=None, mb=None, fact_cap: int = 400) -> list:
    """links: [{artist,title,direction,relation,src_slug,src_artist,src_title,fact}]

    Order matters and it changed once already. Verifying BEFORE the fuzzy merge
    is what lets the merge keep the right spelling: length is not a guide to
    correctness — it kept the misspelt "The Supreme" over "The Supremes" —
    whereas "which of the two does MusicBrainz know" is.
    """
    staged = []
    for lk in links:
        why = shape_reject(lk, lk.get("src_artist", ""), lk.get("src_title", ""))
        if why:
            lk["verdict"], lk["reason"] = "reject", why
            staged.append(lk)
            continue
        # The evidence check is a hard reject ONLY against a complete fact. A
        # stored fact truncated at the column cap routinely omits the second
        # link it produced — production rejected the real Rick James, Bill
        # Withers and Beethoven samples that way, because the sentence naming
        # them sat past the 400th character.
        fact = lk.get("fact") or ""
        truncated = len(fact) >= fact_cap
        if fact and not truncated and not evidence_ok(lk, fact):
            lk["verdict"], lk["reason"] = "reject", "not_in_source_text"
            staged.append(lk)
            continue
        lk["evidence_weak"] = bool(fact) and not evidence_ok(lk, fact)
        lk["verbatim"] = bool(fact) and norm(lk["title"]) in norm(fact, drop_feat=False)
        lk["verdict"] = "pending"
        staged.append(lk)

    pending = [lk for lk in staged if lk["verdict"] == "pending"]
    rejected = [lk for lk in staged if lk["verdict"] == "reject"]

    # Exact-key collapse first: free, and it cuts the number of MB calls.
    pending = exact_dedupe(pending)

    for lk in pending:
        slug = resolve(lk["artist"], lk["title"]) if resolve else None
        if slug:
            lk.update(verdict="verified", reason="in_library", dst_slug=slug, confidence=1.0)
            continue
        if mb is not None:
            print(f"  … MB: {lk['artist']} — {lk['title']}", flush=True)
            res = mb.verify(lk["artist"], lk["title"])
            lk["mb"] = res
            if res.get("verified"):
                lk.update(verdict="verified", reason="musicbrainz", confidence=0.9)
                continue
            if res.get("checked"):
                lk.update(verdict="unverified", reason="mb_no_match", confidence=0.3)
                continue
            lk.update(
                verdict="unverified",
                reason=f"mb_error:{res.get('error', '?')[:40]}",
                confidence=0.5,
            )
            continue
        lk.update(verdict="unverified", reason="unchecked", confidence=0.5)

    merged = fuzzy_merge(pending)
    for lk in merged:
        if lk["verdict"] != "verified" and lk.get("n_sources", 1) >= 2:
            lk.update(verdict="verified", reason="corroborated", confidence=0.8)
    return merged + rejected
