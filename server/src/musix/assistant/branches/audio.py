"""Finding tracks by how they SOUND: CLAP text→audio, four angles, RRF.

The LLM is called twice and neither call is a judgement. The planner turned the
sentence into an intent and a set of filters; this branch asks it once more to
rewrite the user's description of sound into CLAP's own dialect, and then does
arithmetic. There is nothing here for a model to validate — the vector store
already answered — so the caption is written by code and no third call is made.

Why four rephrasings rather than one: a single prompt is one lucky or unlucky
point in CLAP's text space, and its top-10 swings hard on wording that means the
same thing to a human. Four prompts that differ only in which acoustic parameter
they emphasise, merged by reciprocal rank, turn "whatever this phrasing happened
to retrieve" into "what every phrasing agreed on".

The artist never enters the prompt text. It is doing its work as a filter, where
it is exact and free; inside a CLAP prompt it is noise that drags the vector
towards whatever that artist's most typical track sounds like.
"""

from __future__ import annotations

import asyncio
import re
import logging
from typing import Optional

from musix.assistant.models import SearchFilters
from musix.assistant.contracts import AudioResult, Plan
from musix.assistant.llm import as_str_list
from musix.assistant.prompts import CLAP_REPHRASE_SYSTEM
from musix.assistant.library_catalog import filter_by_era

logger = logging.getLogger(__name__)


class AudioBranch:
    def __init__(self, agent):
        self.agent = agent
        self.cfg = agent.cfg
        self.sink = agent.sink
        self.timings = agent.timings

    async def run(self, message: str, plan: Plan) -> AudioResult:
        service = self.agent.search_service
        if service is None:
            return AudioResult(title=message[:80], comment="", notes=["search service unavailable"])
        if plan.filters.song and hasattr(service, "neighbours"):
            like = await self._run_like_track(message, plan, service)
            if like is not None:
                return like
        if plan.filters.sound and hasattr(service, "sound_profiles"):
            return await self._run_with_profile(message, plan, service)

        artist, artist_slug = self._artist(plan.filters.artist)
        style = plan.filters.style or message

        with self.timings.span("llm.clap_rephrase"):
            queries = await self._rephrase(style, artist)
        self.sink.put("clap_rephrase", queries=queries)
        logger.info("[audio] %r -> %s", style, queries)

        if not queries:
            return AudioResult(
                title=_title(plan.filters.style or message),
                comment=_no_prompt(self.cfg.lang),
                notes=["clap rephrasing failed"],
            )

        # A resolved artist is a filter Qdrant can apply itself: every point
        # carries artist_slugs for all of its participants, keyword-indexed, so
        # "Sade feat. …" matches on the same footing as "Sade" and CLAP ranks
        # WITHIN the artist. What that replaces was a funnel — top-K over the
        # whole library, then keep the few tracks that happened to belong to the
        # artist — and on a real library it ended with two tracks out of fifteen.
        #
        # Only what still runs after the search needs a deeper pool: the era, and
        # an artist whose name did not resolve to a slug (ambiguous, or spelled
        # in a way the catalog cannot pin), which falls back to matching names.
        post_filters = bool(plan.filters.era or (artist and not artist_slug))
        limit = self.cfg.clap_limit_per_query * (2 if post_filters else 1)
        filters = SearchFilters(artist_slug=artist_slug) if artist_slug else None
        rankings: list = []
        by_id: dict = {}
        with self.timings.span("search.clap"):
            for query in queries:
                try:
                    hits = await service.search(
                        query,
                        mode="audio",
                        limit=limit,
                        filters=filters,
                        collection_name=self.agent.collection_name,
                    )
                except Exception as exc:  # noqa: BLE001 — one prompt of four
                    logger.warning("[audio] search failed for %r: %s", query, exc)
                    continue
                # Qdrant already answered the artist question when it had a
                # slug; re-checking the display name here could only drop a
                # track it was right about (a compilation credit, a group whose
                # tag names its members).
                hits = self._narrow(
                    hits, era=plan.filters.era, artist=None if artist_slug else artist
                )
                order = []
                for hit in hits:
                    track_id = hit.track.track_id
                    if not track_id:
                        continue
                    by_id.setdefault(track_id, hit)
                    order.append(track_id)
                rankings.append(order)
                self.sink.put("search", source="clap", query=query, found=len(order))

        if not by_id:
            return AudioResult(
                title=_title(plan.filters.style or message),
                comment=_nothing(self.cfg.lang),
                queries=queries,
                notes=["nothing matched"],
            )

        merged = _rrf(rankings, k=self.cfg.clap_rrf_k)
        # «собери из 10 треков» is honoured; otherwise the configured size
        want = plan.filters.count or self.cfg.clap_result_count
        tracks = [by_id[tid] for tid, _ in merged[: max(3, min(want, 40))]]
        for rank, (tid, score) in enumerate(merged[: len(tracks)]):
            by_id[tid].score = float(score)

        self.sink.put("result", tracks=len(tracks), missing=0)
        return AudioResult(
            title=_title(plan.filters.style or message),
            comment=_caption(len(tracks), artist, self.cfg.lang),
            tracks=tracks,
            queries=queries,
        )

    async def _run_with_profile(self, message: str, plan: Plan, service) -> AudioResult:
        """CLAP and the song's measured sound, together (spec sound-search-profile §5).

        CLAP still hears the request — timbre, mood, genre, everything a profile has no
        column for. The profile answers what it measured: hard keys (a named instrument,
        the drums, no voice) SELECT, soft keys (calm, unusual, spacious…) join the RRF as
        rankings of their own, ordered inside the pool. What the profile cannot confirm is
        not dropped silently: it is the second tier, and the caption says so.
        """
        from musix.contexts.sound import query as SQ

        keys = tuple(plan.filters.sound)
        hard = [k for k in keys if k.hard]
        artist, artist_slug = self._artist(plan.filters.artist)
        era = plan.filters.era
        want = max(3, min(plan.filters.count or self.cfg.clap_result_count, 40))
        self.sink.put(
            "sound_keys",
            keys=[{"key": k.key, "word": k.word, "neg": k.neg, "source": k.source} for k in keys],
        )

        # The universe the profile ranks: the artist's catalog when the name resolved
        # (a few hundred tracks — cheaper to score whole than to hope top-K holds what
        # was asked), otherwise the library.
        name_filter = artist if (artist and not artist_slug) else None
        by_name = {"artist_name": name_filter} if name_filter else {}
        with self.timings.span("sound.profiles"):
            profiles = await service.sound_profiles(artist_slug=artist_slug, era=era, **by_name)
        allowed = {tid for tid, p in profiles.items() if SQ.passes_all(p, hard)}

        style = plan.filters.style or message
        with self.timings.span("llm.clap_rephrase"):
            queries = await self._rephrase(style, artist)
        self.sink.put("clap_rephrase", queries=queries)

        if artist_slug or name_filter:
            # a name without a slug is filtered after the search: the pool must be deep
            # enough to hold the artist's tracks
            limit = self.cfg.sound_artist_pool
        else:
            # hard keys are applied after the search: a deeper pool keeps enough of
            # what passes them
            limit = self.cfg.clap_limit_per_query * (4 if hard else 2)
        filters = SearchFilters(artist_slug=artist_slug) if artist_slug else None
        rankings: list = []
        by_id: dict = {}
        with self.timings.span("search.clap"):
            for query in queries:
                try:
                    hits = await service.search(
                        query,
                        mode="audio",
                        limit=limit,
                        filters=filters,
                        collection_name=self.agent.collection_name,
                    )
                except Exception as exc:  # noqa: BLE001 — one prompt of four
                    logger.warning("[audio] search failed for %r: %s", query, exc)
                    continue
                hits = self._narrow(hits, era=era, artist=name_filter)
                order = []
                for hit in hits:
                    tid = hit.track.track_id
                    if tid:
                        by_id.setdefault(tid, hit)
                        order.append(tid)
                rankings.append(order)
                self.sink.put("search", source="clap", query=query, found=len(order))

        # The profile's own rankings. With hard keys they rank only what passes them:
        # a track without the guitar cannot be voted up by being calm.
        universe = {tid: p for tid, p in profiles.items() if not hard or tid in allowed}
        prof = SQ.rankings(universe, keys)
        if not artist_slug and not name_filter:
            prof = [r[: self.cfg.sound_profile_pool] for r in prof]
        prof = [r for r in prof if r]

        missing = [tid for r in prof for tid in r if tid not in by_id]
        if missing:
            mfs = list(dict.fromkeys(profiles[tid].media_file_id for tid in missing))
            with self.timings.span("sound.tracks"):
                extra = await service.track_hits(mfs)
            for hit in self._narrow(extra, era=era, artist=name_filter):
                by_id.setdefault(hit.track.track_id, hit)
        prof = [[tid for tid in r if tid in by_id] for r in prof]

        if not by_id:
            return AudioResult(
                title=_title(plan.filters.style or message),
                comment=_nothing(self.cfg.lang),
                queries=queries,
                notes=["nothing matched"],
            )

        share = self.cfg.sound_profile_weight / len(prof) if prof else 0.0
        weights = [1.0] * len(rankings) + [share] * len(prof)
        merged = _rrf(rankings + prof, k=self.cfg.clap_rrf_k, weights=weights)

        first = _songs_first([tid for tid, _ in merged if not hard or tid in allowed], by_id)
        rest = _songs_first([tid for tid, _ in merged if hard and tid not in allowed], by_id)
        self.sink.put("sound_filter", pool=len(merged), passed=len(first), hard=len(hard))
        if len(first) >= min(want, 5):
            picked, tiers = first[:want], [1] * min(want, len(first))
        else:
            fill = rest[: want - len(first)]
            picked, tiers = first + fill, [1] * len(first) + [2] * len(fill)
            if fill:
                self.sink.put("sound_relaxed", first=len(first), added=len(fill))

        score = dict(merged)
        tracks = []
        for tid in picked:
            hit = by_id[tid]
            hit.score = float(score[tid])
            tracks.append(hit)

        comment = _sound_caption(
            keys,
            first=sum(1 for t in tiers if t == 1),
            added=sum(1 for t in tiers if t == 2),
            artist=artist,
            lang=self.cfg.lang,
        )
        self.sink.put("result", tracks=len(tracks), missing=0)
        return AudioResult(
            title=_title(plan.filters.style or message),
            comment=comment,
            tracks=tracks,
            queries=queries,
            tiers=tiers,
            sound_keys=[("-" if k.neg else "") + k.key for k in keys],
        )

    async def _run_like_track(self, message: str, plan: Plan, service) -> Optional[AudioResult]:
        """«похожее на Moon, но с живыми барабанами», «как Midnight City, только спокойнее».

        The pool is the track's own neighbours by its CLAP vector — what «похожее на» means
        — and everything after «но» works inside it: hard keys select, soft keys rank, and
        a description the profile has no column for («но мрачнее») is a CLAP prompt scored
        ONLY among the neighbours. None when the library has no such track: the request is
        then read as an ordinary description of sound.
        """
        from musix.contexts.search.normalize import fold
        from musix.contexts.sound import query as SQ

        # the planner's `song` is not checked against the sentence anywhere else
        if not fold(plan.filters.song or "") or fold(plan.filters.song) not in fold(message):
            return None
        _, artist_slug = self._artist(plan.filters.artist)
        with self.timings.span("sound.seed"):
            seed = await service.find_track(plan.filters.song, artist_slug)
        if seed is None:
            self.sink.put("like_track", song=plan.filters.song, found=False)
            return None
        keys = tuple(plan.filters.sound)
        hard = [k for k in keys if k.hard]
        want = max(3, min(plan.filters.count or self.cfg.clap_result_count, 40))
        depth = self.cfg.like_track_pool * (2 if hard else 1)
        with self.timings.span("search.neighbours"):
            pairs = await service.neighbours(seed["media_file_id"], depth)
        mf_of = {id(h): mf for mf, h in pairs}
        near = self._narrow([h for _, h in pairs], era=plan.filters.era, artist=None)
        near = _without_versions(near, seed["title"])
        self.sink.put("like_track", song=seed["title"], artist=seed["artist"], pool=len(near))
        if not near:
            return None
        by_id = {h.track.track_id: h for h in near}
        rankings = [[h.track.track_id for h in near]]
        weights = [self.cfg.like_track_weight]

        # what the profile cannot say, CLAP says — but only about the neighbours
        style = _without(plan.filters.style or "", seed["title"], [k.word for k in keys])
        queries: list = []
        if style:
            with self.timings.span("llm.clap_rephrase"):
                queries = await self._rephrase(style, None)
            ids = [mf_of[id(h)] for h in near]
            inside = SearchFilters(point_ids=ids)
            for query in queries:
                try:
                    hits = await service.search(
                        query,
                        mode="audio",
                        limit=len(ids),
                        filters=inside,
                        collection_name=self.agent.collection_name,
                    )
                except Exception as exc:  # noqa: BLE001 — one prompt of four
                    logger.warning("[audio] search failed for %r: %s", query, exc)
                    continue
                rankings.append([h.track.track_id for h in hits if h.track.track_id in by_id])
                weights.append(1.0)

        allowed = set(by_id)
        if keys:
            with self.timings.span("sound.profiles"):
                profiles = await service.sound_profiles(track_ids=list(by_id))
            allowed = {tid for tid in by_id if SQ.passes_all(profiles.get(tid), hard)}
            universe = {tid: p for tid, p in profiles.items() if tid in allowed}
            prof = [r for r in SQ.rankings(universe, keys) if r]
            if prof:
                share = self.cfg.sound_profile_weight / len(prof)
                rankings += prof
                weights += [share] * len(prof)
            self.sink.put("sound_filter", pool=len(by_id), passed=len(allowed), hard=len(hard))

        merged = _rrf(rankings, k=self.cfg.clap_rrf_k, weights=weights)
        first = _songs_first([tid for tid, _ in merged if tid in allowed], by_id)
        rest = _songs_first([tid for tid, _ in merged if tid not in allowed], by_id)
        if len(first) >= min(want, 5):
            picked, tiers = first[:want], [1] * min(want, len(first))
        else:
            fill = rest[: want - len(first)]
            picked, tiers = first + fill, [1] * len(first) + [2] * len(fill)
        score = dict(merged)
        tracks = []
        for tid in picked:
            by_id[tid].score = float(score[tid])
            tracks.append(by_id[tid])

        first_n = sum(1 for t in tiers if t == 1)
        added = len(tiers) - first_n
        return AudioResult(
            title=_like_title(seed["title"], keys, self.cfg.lang),
            comment=_like_caption(seed, keys, first_n, added, self.cfg.lang),
            tracks=tracks,
            queries=queries,
            tiers=tiers,
            sound_keys=[("-" if k.neg else "") + k.key for k in keys] or ["like"],
        )

    async def _rephrase(self, style: str, artist: Optional[str]) -> list:
        """The user's description of sound as ``clap_queries`` CLAP prompts.

        The artist name is given as CONTEXT for the model to reason from ("Sade
        sounds smooth and slow"), never to be echoed into the prompt — rule 8 of
        the system prompt covers that, and the prompt itself forbids the name.
        """
        hint = f"{style} (the listener also named the artist {artist})" if artist else style
        messages = [
            {"role": "system", "content": CLAP_REPHRASE_SYSTEM.format(user_query=hint)},
            {"role": "user", "content": hint},
        ]

        def _usable(value) -> list:
            return [q for q in as_str_list(value, limit=self.cfg.clap_queries, item_limit=200) if q]

        queries = _usable(await self.agent.llm.ask_list(messages))
        if not queries:
            # One repair round before giving up. ``ask_list`` skips the repair
            # on the theory that every caller has a cheap deterministic
            # fallback — which is true here only for a listener who wrote in
            # English, and these failures are formatting rather than
            # capability: the model writes four good prompts and names the
            # field something the coercion did not read.
            last_raw = getattr(self.agent.llm, "last_raw", "") or ""
            logger.info("[audio] rephrasing unusable (%r) — one repair round", last_raw[:160])
            queries = _usable(
                await self.agent.llm.ask_list(
                    messages
                    + [
                        {"role": "assistant", "content": last_raw[:2000]},
                        {
                            "role": "user",
                            "content": "Reply with the JSON array of 4 plain strings and "
                            "nothing else. No objects, no keys, no prose, no "
                            "markdown fence.",
                        },
                    ]
                )
            )

        if not queries:
            # The old fallback pasted the style straight into the template and
            # searched that. It only works when the style is already English:
            # CLAP's text tower is trained on English audio captions, so
            # "This song is a спокойное" is not a weak query, it is noise, and
            # the ten tracks it returns are indistinguishable from random. An
            # empty list makes the branch say so instead of pretending.
            if _is_latin(style):
                logger.info("[audio] rephrasing failed — falling back to the listener's own words")
                return [f"This song is a {style}"]
            logger.warning(
                "[audio] rephrasing failed and %r is not usable as a CLAP prompt — no audio search",
                style,
            )
            return []
        return queries[: self.cfg.clap_queries]

    def _artist(self, raw: Optional[str]) -> tuple:
        """``(name, slug)`` of the artist the request named. Without a slug the name is
        the listener's own word, not the catalog's best guess: «Kanye» came back as the
        shortlist's «Kokane», and filtering by it emptied every list (eval 2026-11-12, K7).
        The listener's word still matches «Kanye West» by containment."""
        name, slug = self.agent.library_artist_ref(raw)
        return (name, slug) if slug else (raw, None)

    def _narrow(self, hits: list, *, artist: Optional[str], era: Optional[tuple]) -> list:
        if artist:
            from musix.assistant.branches.lyrics import _artist_matches

            hits = [h for h in hits if _artist_matches(artist, h.track.artist)]
        if era:
            hits = filter_by_era(hits, era, year=lambda h: h.track.year)
        return hits


def _rrf(rankings: list, *, k: int = 60, weights: Optional[list] = None) -> list:
    """``[(track_id, score), ...]`` best first, fused across the ranked lists.

    Reciprocal rank rather than raw CLAP similarity: the four prompts are four
    different points in the text space and their score scales are not comparable,
    while their ORDERS are. A track that every prompt put near the top beats one
    that a single prompt loved. The same holds for the sound profile's rankings,
    which join with a weight of their own.
    """
    scores: dict = {}
    for i, order in enumerate(rankings):
        w = 1.0 if weights is None else weights[i]
        for rank, track_id in enumerate(order, start=1):
            scores[track_id] = scores.get(track_id, 0.0) + w / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


def _songs_first(order: list, by_id: dict) -> list:
    """Skits and intros after the songs. The profile keeps them out of its own rankings
    (``query.MIN_SONG_S``), but a CLAP prompt still loves a 40-second «Intro» for «странное»
    — eval 2026-11-12, A7 and A9. Moved, not dropped: «короткие интерлюдии» may be wanted."""
    from musix.contexts.sound.query import MIN_SONG_S

    def short(tid: str) -> bool:
        secs = by_id[tid].track.duration_sec or 0
        return 0 < secs < MIN_SONG_S

    return [t for t in order if not short(t)] + [t for t in order if short(t)]


_VERSION_TAIL = re.compile(r"\s*[(\[][^)\]]*[)\]]|\s+-\s+.*$")


def _base_title(title: str) -> str:
    """«Moon (Remastered 2011)», «Moon - Live» → «moon»."""
    from musix.contexts.search.normalize import fold

    return fold(_VERSION_TAIL.sub("", title or "")) or fold(title or "")


def _without_versions(hits: list, seed_title: str) -> list:
    """The seed's other versions out («Moon» from a deluxe edition, «Moon - Live» are
    not «похожее на Moon»), and one copy of a song the library holds twice (the same
    title and length — «Spend Some Time» filed under Eminem and under 50 Cent)."""
    seed = _base_title(seed_title)
    seen: set = set()
    out = []
    for h in hits:
        t = h.track
        key = (_base_title(t.title_display or t.title), round((t.duration_sec or 0) / 4))
        if key[0] == seed or key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out


def _without(style: str, title: str, words: list) -> str:
    """What is left of the style for CLAP once the track's title and the words the profile
    already answers are taken out: «как Midnight City, только мрачнее» → «мрачнее»."""
    from musix.contexts.search.normalize import fold

    drop = set(fold(title).split())
    for w in words:
        drop |= set(fold(w).split())
    drop |= {"похоже", "похожее", "похожие", "похож", "как", "но", "только", "на", "like", "but"}
    kept = [w for w in style.split() if len(fold(w)) > 2 and fold(w) not in drop]
    return " ".join(kept)


def _like_title(title: str, keys, lang: str) -> str:
    from musix.contexts.sound import query as SQ

    ru = (lang or "").lower().startswith("ru")
    head = f"Похожее на «{title}»" if ru else f"Like «{title}»"
    return f"{head} — {SQ.phrase(keys, lang)}"[:80] if keys else head[:80]


def _like_caption(seed: dict, keys, first: int, added: int, lang: str) -> str:
    from musix.contexts.sound import query as SQ

    ru = (lang or "").lower().startswith("ru")
    what = f"«{seed['title']}» ({seed['artist']})" if seed.get("artist") else f"«{seed['title']}»"
    hard = [k for k in keys if k.hard]
    if ru:
        asked = f": {SQ.phrase(keys, lang)}" if keys else ""
        if not added:
            return f"Подобрал {first} трек(ов), похожих на {what}{asked}."
        if first == 0:
            return (
                f"Среди похожих на {what} треков {SQ.phrase(hard, lang)} не нашлось — "
                f"вот просто похожие ({added})."
            )
        return (
            f"Среди похожих на {what} {SQ.phrase(hard, lang)} нашлось {first} — "
            f"добавил ещё {added} просто похожих."
        )
    asked = f": {SQ.phrase(keys, lang)}" if keys else ""
    if not added:
        return f"{first} tracks like {what}{asked}."
    return f"Only {first} like {what} with {SQ.phrase(hard, lang)}; added {added} that just sound close."


def _sound_caption(keys, *, first: int, added: int, artist: Optional[str], lang: str) -> str:
    """What was found, written by code: the asks in words, and — when the hard keys left
    too few — how many and what was added. Never a number from the profile."""
    from musix.contexts.sound import query as SQ

    ru = (lang or "").lower().startswith("ru")
    hard = [k for k in keys if k.hard]
    asked = SQ.phrase(keys, lang)
    if ru:
        who = f" {artist}" if artist else ""
        at = f" у {artist}" if artist else ""
        if not added:
            return f"Подобрал {first} трек(ов){who}: {asked}."
        what = SQ.phrase(hard, lang)
        if first == 0:
            return f"Треков {what}{at} не нашлось — вот похожее по звучанию ({added})."
        return (
            f"{what[:1].upper()}{what[1:]}{at} нашлось {first} — "
            f"добавил ещё {added} похожих по звучанию."
        )
    by = f" by {artist}" if artist else ""
    if not added:
        return f"{first} tracks{by}: {asked}."
    what = SQ.phrase(hard, lang)
    if first == 0:
        return f"Nothing{by} with {what} — here is what sounds close ({added})."
    return f"Only {first}{by} with {what}; added {added} that sound close."


# «найди в моей библиотеке что-то», «собери плейлист из 10 треков»: the request around the
# description, not a title for it
_ASK = re.compile(
    r"^(?:пожалуйста[,\s]+)?(?:найди|подбери|собери|сделай|составь|включи|поставь|дай|покажи|хочу|find|make|build|play|give me)\b"
    r"(?:\s+(?:мне|в\s+моей\s+библиотеке|из\s+библиотеки|плейлист|подборку|треки|песни|музыку|что-?(?:то|нибудь)|playlist|songs|tracks|music|some|из\s+\d+\s+\w+))*"
    r"(?:\s+(?:по\s+звучанию\s+)?похож\w*\s+на)?\s*",
    re.I,
)


def _title(text: str) -> str:
    """The playlist's name: the user's own description of sound, capitalised, without
    the request around it. Before, the whole sentence was the title («найди в моей
    библиотеке что-то по звучанию похожее на …»)."""
    t = " ".join((text or "").split())
    core = _ASK.sub("", t).strip(" ,.!?") or t
    return (core[:1].upper() + core[1:])[:80] or "Подборка по звучанию"


def _caption(count: int, artist: Optional[str], lang: str) -> str:
    ru = (lang or "").lower().startswith("ru")
    if ru:
        who = f" у {artist}" if artist else ""
        return f"Подобрал {count} трек(ов) по звучанию{who}."
    who = f" by {artist}" if artist else ""
    return f"{count} tracks picked by how they sound{who}."


def _is_latin(text: str) -> bool:
    """True when ``text`` carries at least one Latin letter and no other script.

    The gate for "may this go into a CLAP prompt": the model is English-only,
    so a Cyrillic (or CJK, or Greek) style word is out-of-distribution noise
    rather than a weak query. Digits and punctuation are neutral.
    """
    letters = [ch for ch in (text or "") if ch.isalpha()]
    if not letters:
        return False
    return all("A" <= ch <= "Z" or "a" <= ch <= "z" for ch in letters)


def _no_prompt(lang: str) -> str:
    return (
        "Не получилось перевести описание звучания в запрос для поиска по "
        "звуку — попробуй переформулировать."
        if (lang or "").lower().startswith("ru")
        else "Could not turn that description into an audio-search prompt — try rephrasing."
    )


def _nothing(lang: str) -> str:
    return (
        "По звучанию ничего не нашлось — попробуй описать иначе."
        if (lang or "").lower().startswith("ru")
        else "Nothing matched by sound — try describing it differently."
    )
