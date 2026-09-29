"""Gate fixtures, derived once per snapshot from its own Qdrant dump, seeded by the
snapshot date so every run on that snapshot asks the same questions.

Stored next to the snapshot (they contain lyrics and titles), never in git.
"""

from __future__ import annotations

import gzip
import json
import random
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

CYR = re.compile(r"[а-яё]", re.I)
WORD = re.compile(r"[\w'’-]+", re.U)
FEAT = re.compile(r"\s*[\(\[]\s*(feat\.?|ft\.?|featuring)\s[^\)\]]*[\)\]]", re.I)
# One fixed GOST-like table: deterministic, no randomness in translit.
TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o",
                     "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e",
                     "yu", "ya"], strict=True))


def translit(s: str) -> str:
    out = []
    for c in s:
        t = TRANSLIT.get(c.lower())
        out.append(c if t is None else (t.capitalize() if c.isupper() else t))
    return "".join(out)


def typo(s: str, rng: random.Random, n: int) -> str:
    chars = list(s)
    idx = [i for i, c in enumerate(chars) if c.isalpha()]
    for i in rng.sample(idx, min(n, len(idx))):
        op = rng.choice(("swap", "drop", "dup"))
        if op == "swap" and i + 1 < len(chars):
            chars[i], chars[i + 1] = chars[i + 1], chars[i]
        elif op == "drop":
            chars[i] = ""
        else:
            chars[i] = chars[i] * 2
    return "".join(chars)


def load_points(snap: Path) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for f in sorted((snap / "qdrant").glob("acct_*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            out[f.name.removesuffix(".jsonl.gz")] = [
                {"id": str(r["id"]), **{k: r["payload"].get(k) for k in
                 ("title", "artist", "album", "genre", "lyrics", "sonic_tags", "sonic_axes", "year")}}
                for r in map(json.loads, fh)]
    return out


def lyric_fixture(points: dict[str, list[dict[str, Any]]], rng: random.Random, n: int = 300) -> list[dict[str, Any]]:
    pool = []
    for coll, pts in points.items():
        for p in pts:
            lines = [ln.strip() for ln in (p["lyrics"] or "").splitlines()
                     if 8 <= len(WORD.findall(ln)) <= 16 and not ln.strip().startswith("[")]
            if len(lines) >= 3:
                lang = "ru" if CYR.search(p["lyrics"]) else "en"
                pool.append((coll, p, lang, lines))
    strata: dict[tuple[str, str], list[Any]] = defaultdict(list)
    for item in pool:
        strata[(item[2], item[1]["genre"] or "?")].append(item)
    picked: list[Any] = []
    keys = sorted(strata)
    while len(picked) < n and any(strata.values()):
        for k in keys:
            if strata[k] and len(picked) < n:
                picked.append(strata[k].pop(rng.randrange(len(strata[k]))))
    queries = []
    for coll, p, lang, lines in picked:
        line = rng.choice(lines)
        words = WORD.findall(line)
        exact = " ".join(words[:12])
        k = rng.randint(4, 6)
        start = rng.randint(1, max(1, len(words) - k))
        queries += [
            {"coll": coll, "track": p["id"], "kind": "exact", "q": exact},
            {"coll": coll, "track": p["id"], "kind": "partial", "q": " ".join(words[start:start + k])},
            {"coll": coll, "track": p["id"], "kind": "noisy", "q": typo(exact.lower(), rng, rng.randint(1, 2))},
        ]
        if lang == "ru":
            queries.append({"coll": coll, "track": p["id"], "kind": "translit", "q": translit(exact.lower())})
    return queries


# Axis poles phrased as a listener would; relevant = that pole's quarter of the library.
AXIS_PROMPTS = {
    "energy": ("energetic upbeat music", "calm quiet music"),
    "vocal_lead": ("vocal-driven song", "instrumental music"),
    "spacious": ("spacious ambient reverb", "dry close-mic sound"),
    "experimental": ("experimental avant-garde music", "conventional pop song"),
    "brightness": ("bright sparkling sound", "dark muffled sound"),
    "acousticness": ("acoustic unplugged", "electronic synthesized music"),
}


def sound_fixture(points: dict[str, list[dict[str, Any]]], rng: random.Random, n: int = 80) -> list[dict[str, Any]]:
    """Consistency prompts. The library's sonic_tags are empty in practice, so the
    prompts come from its genres, decades and the six sonic-axis poles."""
    prompts = []
    for coll, pts in points.items():
        tags: dict[str, set[str]] = defaultdict(set)
        genres: dict[str, set[str]] = defaultdict(set)
        decades: dict[int, set[str]] = defaultdict(set)
        for p in pts:
            for t in p["sonic_tags"] or []:
                tags[str(t).lower()].add(p["id"])
            if p["genre"]:
                genres[p["genre"]].add(p["id"])
            if isinstance(p["year"], int) and 1950 <= p["year"] <= 2030:
                decades[p["year"] // 10 * 10].add(p["id"])
        for t, ids in tags.items():
            if len(ids) >= 10:
                prompts.append({"coll": coll, "q": t, "kind": "tag", "relevant": sorted(ids)})
        for g, ids in genres.items():
            if len(ids) >= 10 and g.lower() != "other":
                prompts.append({"coll": coll, "q": f"{g.lower()} music", "kind": "genre", "relevant": sorted(ids)})
        for d, ids in decades.items():
            if len(ids) >= 20:
                prompts.append({"coll": coll, "q": f"music from the {d % 100:02d}s", "kind": "decade", "relevant": sorted(ids)})
        if len(pts) >= 100:
            for axis, (hi, lo) in AXIS_PROMPTS.items():
                vals = sorted((p["sonic_axes"] or {}).get(axis, 0.0) for p in pts)
                q1, q3 = vals[len(vals) // 4], vals[3 * len(vals) // 4]
                top = sorted(p["id"] for p in pts if (p["sonic_axes"] or {}).get(axis, 0.0) >= q3)
                bot = sorted(p["id"] for p in pts if (p["sonic_axes"] or {}).get(axis, 0.0) <= q1)
                prompts.append({"coll": coll, "q": hi, "kind": "axis", "relevant": top})
                prompts.append({"coll": coll, "q": lo, "kind": "axis", "relevant": bot})
    rng.shuffle(prompts)
    return prompts[:n]


def catalog_fixture(points: dict[str, list[dict[str, Any]]], rng: random.Random, n: int = 300) -> list[dict[str, Any]]:
    items = [(c, p) for c, pts in points.items() for p in pts if p["title"] and p["artist"]]
    rng.shuffle(items)
    kinds = ["exact", "prefix", "typo", "feat", "translit", "album"]
    out: list[dict[str, Any]] = []
    for c, p in items:
        if len(out) >= n:
            break
        kind = kinds[len(out) % len(kinds)]
        t = p["title"]
        if kind == "exact":
            q, want = t, ("song", p["id"])
        elif kind == "prefix" and len(t) >= 6:
            q, want = t[: max(3, int(len(t) * 0.6))], ("song", p["id"])
        elif kind == "typo" and len(t) >= 6:
            q, want = typo(t, rng, 1), ("song", p["id"])
        elif kind == "feat" and FEAT.search(t):
            q, want = FEAT.sub("", t), ("song", p["id"])
        elif kind == "translit" and CYR.search(p["artist"]):
            q, want = translit(p["artist"].lower()), ("artist", p["artist"])
        elif kind == "album" and p["album"]:
            q, want = p["album"], ("album", p["album"])
        else:
            continue
        out.append({"coll": c, "kind": kind, "q": q, "want_kind": want[0], "want": want[1]})
    return out


def build(snap: Path) -> dict[str, Any]:
    cached = snap / "gates" / "fixtures.json"
    if cached.exists():
        return dict(json.loads(cached.read_text()))
    rng = random.Random(snap.name)
    points = load_points(snap)
    fx = {"lyrics": lyric_fixture(points, rng), "sound": sound_fixture(points, rng),
          "catalog": catalog_fixture(points, rng)}
    cached.parent.mkdir(exist_ok=True)
    cached.write_text(json.dumps(fx, ensure_ascii=False))
    return fx
