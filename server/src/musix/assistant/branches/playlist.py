"""Requests for songs to play, answered from the web and matched to the library.

Everything that decides WHICH tracks come back is code: the tables are parsed,
the claims are matched against the library, the sources are weighted and the era
filters. The model gets two jobs and neither can add a track — triage (which of
these was the page actually offering?) and curation (order them and say why).
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

from musix.assistant.branches.base import WebBranch
from musix.assistant.contracts import Plan, PlaylistResult
from musix.assistant.selection import (
    curate_tracks,
    select_and_curate,
    select_tracks,
    track_listing,
    triage_tracks,
)
from musix.assistant.tracklists import TrackExtractor, has_structured_parser, structured_tracks
from musix.assistant.web_urls import dedupe_by_url

logger = logging.getLogger(__name__)

# Titles to try for the discography rescue, in order, until one yields rows.
#
# There is no single naming convention and no way to know which an artist has.
# "Kanye West discography" is a disambiguation stub — three links, no table —
# while the songs live under "singles discography"; JAY-Z's are under "albums
# discography"; Sade's are on the plain "discography" page. A page that yields
# nothing is almost always the stub, so the next spelling is simply tried.
#
# Order is by usefulness for a PLAYLIST: singles and song lists are tracks, an
# albums table is albums. The albums page is last and its rows arrive labelled
# with their section, so the triage pass can see what they are.
DISCOGRAPHY_TITLES = (
    "{artist} singles discography",
    "List of songs recorded by {artist}",
    "{artist} discography",
    "{artist} albums discography",
)


class PlaylistBranch(WebBranch):
    async def run(self, message: str, plan: Plan) -> PlaylistResult:
        # Two numbers, because one was doing two jobs that only agree by accident.
        # ``target`` is when to STOP SEARCHING; ``cap`` is how many tracks to
        # RETURN. They diverge exactly on a soundtrack: the whole tracklist
        # arrives from a single page, so the run has everything it will ever get
        # the moment it has fifteen — and truncating there discards the other
        # thirty it already matched against the library.
        target = plan.filters.count or self.cfg.default_target_count
        cap = plan.filters.count or (
            self.cfg.work_target_count if plan.filters.work else self.cfg.default_target_count
        )
        # Resolved once: table rows that name no artist are tagged with it, and
        # the user's spelling («Канье») matches nothing in the library.
        artist = self._library_artist(plan)
        queries, ce_query = list(plan.web_queries), plan.ce_query
        claims: list = []
        notes: list = []
        iterations = relaxations = 0

        # The discography rescue is a deterministic query («<artist> singles
        # discography»), so for an artist request it starts now, alongside the
        # first round, instead of after every round has come back short. Its claims
        # are only used if the rounds do come back short.
        rescue = None
        if self.cfg.discography_speculative and plan.filters.artist and not plan.filters.work:
            # Its own SearchSources: the speculative searches must not spend the
            # round budget the relaxation rounds may still need.
            from musix.assistant.web_sources import SearchSources

            rescue = asyncio.ensure_future(
                self._discography(
                    plan, found=0, quiet=True, sources=SearchSources(self.cfg, self.sink)
                )
            )

        while iterations < self.cfg.playlist_max_iterations:
            iterations += 1
            self.sink.put("iteration", n=iterations, queries=queries)
            stop = asyncio.Event()
            late_prose: list = []

            async def on_structured(pages: list) -> None:
                # A parseable page is matched against the library as it arrives;
                # once the target is met the round stops waiting for the rest.
                parsed, prose_left = await self._harvest(pages, artist=artist)
                late_prose.extend(prose_left)
                if not parsed:
                    return
                claims.extend(parsed)
                got = await self._resolve_off_loop(claims, plan)
                if len(got) >= target:
                    stop.set()

            structured_pages, prose_pages = await self.gather(
                plan, queries, ce_query, structured=True, on_structured=on_structured, stop=stop
            )

            parsed, prose = await self._harvest(prose_pages, artist=artist)
            claims += parsed
            prose = late_prose + prose

            resolved, _ = self._resolve(claims, plan)
            # The model reading prose is the slowest and least reliable way to a
            # track list: it only runs when the tables did not already deliver.
            if len(resolved) < target:
                self.index(prose)
                chunks = self.best_chunks(ce_query)
                if chunks:
                    extractor = TrackExtractor(self.agent.llm, self.cfg, self.sink)
                    with self.timings.span("llm.extract"):
                        base = list(claims)

                        async def enough(found: list) -> bool:
                            got = await self._resolve_off_loop(base + found, plan)
                            return len(got) >= target

                        claims += await extractor.from_passages(
                            [(c.url, c.text) for c, _ in chunks], request=message, enough=enough
                        )
                resolved, _ = self._resolve(claims, plan)
            else:
                notes.append("tables met the target — prose extraction skipped")
            self.sink.put("matched", claims=len(claims), resolved=len(resolved), target=target)

            if len(resolved) >= target:
                break

            enough = len(resolved) >= target * self.cfg.min_yield_ratio
            budget_left = iterations < self.cfg.playlist_max_iterations
            if enough or not budget_left:
                break

            # Not enough after filtering. Take a constraint OUT of the query text
            # and let the code-side filter do that work instead — the phrase
            # "спокойные хиты 80х" narrows the web result set far more than it
            # narrows the truth.
            relaxed = self._relax(plan, queries, relaxations)
            if relaxed is None:
                notes.append("nothing left to relax")
                break
            relaxations += 1
            queries = relaxed
            notes.append(f"relaxed the query (round {relaxations})")

        resolved, missing = self._resolve(claims, plan)
        if len(resolved) < self.cfg.discography_min_tracks:
            with self.timings.span("discography"):
                if rescue is not None:
                    self.sink.put("discography", artist=plan.filters.artist, found=len(resolved))
                    try:
                        rescued = await rescue
                    except Exception:  # noqa: BLE001 — a failed rescue is no rescue
                        logger.warning("[playlist] speculative discography failed", exc_info=True)
                        rescued = []
                    rescue = None
                else:
                    rescued = await self._discography(plan, found=len(resolved))
            if rescued:
                claims += rescued
                resolved, missing = self._resolve(claims, plan)
                notes.append(f"discography rescue added {len(rescued)} claims")
        if rescue is not None:
            rescue.cancel()

        with self.timings.span("sound.filter"):
            resolved, passed = await self._sound_filter(resolved, plan)

        if self.cfg.merge_triage_curate:
            with self.timings.span("llm.select"):
                title, comment, resolved = await select_and_curate(
                    self.agent.llm, message, resolved, cap=cap, config=self.cfg, sink=self.sink
                )
        else:
            with self.timings.span("llm.triage"):
                resolved = await triage_tracks(
                    self.agent.llm, message, resolved, config=self.cfg, sink=self.sink
                )
            resolved = resolved[:cap]
            with self.timings.span("llm.curate"):
                title, comment, resolved = await curate_tracks(
                    self.agent.llm, message, resolved, config=self.cfg, sink=self.sink
                )
        comment = await self._edit_comment(comment, resolved)
        sound_note = ""
        tiers: list = []
        if passed is not None:
            first = [t for t in resolved if str(t.track_id) in passed]
            rest = [t for t in resolved if str(t.track_id) not in passed]
            resolved = first + rest
            tiers = [1] * len(first) + [2] * len(rest)
            if rest:
                sound_note = _sound_note(plan, len(first), len(rest), self.cfg.lang)
                notes.append(f"sound keys: {len(first)} passed, {len(rest)} added")
        self.sink.put("result", tracks=len(resolved), missing=len(missing))
        return PlaylistResult(
            title=title,
            comment=comment,
            tracks=resolved,
            missing=missing[:40],
            iterations=iterations,
            relaxations=relaxations,
            notes=notes,
            sound_note=sound_note,
            tiers=tiers,
        )

    async def _sound_filter(self, resolved: list, plan: Plan) -> tuple:
        """``(tracks, passed_ids)`` — the hard sound keys («хиты Канье с гитарой») applied
        to what the web found. Soft keys do not reorder a playlist: its order is fame.

        When fewer than ``SOUND_PLAYLIST_MIN`` pass, the rest stay after them so the
        answer is not three songs long, and the caption says so. ``passed_ids`` is None
        when no hard key was asked (or nothing can read the profiles).
        """
        from musix.contexts.sound import query as SQ

        hard = [k for k in plan.filters.sound if k.hard]
        service = self.agent.search_service
        if not hard or not resolved or not hasattr(service, "sound_profiles"):
            return resolved, None
        ids = [str(t.track_id) for t in resolved]
        profiles = await service.sound_profiles(track_ids=ids)
        passed = {tid for tid in ids if SQ.passes_all(profiles.get(tid), hard)}
        first = [t for t in resolved if str(t.track_id) in passed]
        self.sink.put("sound_filter", pool=len(resolved), passed=len(first), hard=len(hard))
        if len(first) >= SOUND_PLAYLIST_MIN:
            return first, passed
        rest = [t for t in resolved if str(t.track_id) not in passed]
        self.sink.put("sound_relaxed", first=len(first), added=len(rest))
        return first + rest, passed

    async def _harvest(self, pages: list, *, artist: Optional[str]) -> tuple:
        """``(claims, prose)`` — parse what has a parser, hand back the rest.

        Routing is by HOST, and it used to be by search stream, which is not the
        same thing: ``gather`` splits its result by which stream found each page,
        so a Wikipedia discography that only the open-web search surfaced went
        into the prose lane and was read by the MODEL. That is the most expensive
        way to read a table. Extraction emits one JSON object per track, so its
        output — and therefore its wall time, the largest single span in a
        playlist run — grows with the length of the list it is retyping, and it
        was retyping rows that parse in milliseconds.

        A parser that comes back empty hands the page to the prose lane rather
        than dropping it. ``tracks_from_markdown`` reads markdown TABLES and
        nothing else, so a Fandom soundtrack written as a bulleted list is a page
        full of real tracks with no rows in it — and refusing it on its host alone
        would lose the whole page instead of just the cheap way of reading it.
        """
        claims: list = []
        prose: list = []
        for page in pages:
            if not has_structured_parser(page):
                prose.append(page)
                continue
            # concurrent: pages of one round are parsed as each arrives
            with self.timings.concurrent("structured.tables"):
                found = await asyncio.to_thread(structured_tracks, page, default_artist=artist)
            if found:
                claims += found
                self.sink.put("structured", url=page.url, tracks=len(found))
                continue
            logger.info(
                "[playlist] %s: a parseable host with nothing to parse — reading it as prose",
                page.url,
            )
            prose.append(page)
        return claims, prose

    def _library_artist(self, plan: Plan) -> Optional[str]:
        """The artist as the LIBRARY spells it, best effort.

        Used for two things: the rows of a table that names no artist, and the
        discography search. Both want "Kanye West" where the user typed «Канье» —
        a table row tagged with the Cyrillic spelling matches nothing in the
        library, and a Cyrillic query finds nothing on the English Wikipedia.

        A best guess is acceptable here, unlike when choosing whose FACTS to read:
        every title is still matched against the library under this name, so a
        wrong guess yields no tracks rather than the wrong ones.
        """
        return self.agent.library_artist(plan.filters.artist)

    async def _edit_comment(self, comment: str, tracks: list) -> str:
        """The curate step's one sentence becomes the playlist's blurb — through the
        same editor every other text the listener reads goes through (a draft once
        invented a chart record for «Blinding Lights»). It replaces the separate
        blurb call the page used to make after the agent: one call instead of two."""
        if not self.cfg.playlist_comment_as_blurb:
            return ""  # the page writes its own blurb, as before
        if not comment or not tracks:
            return comment
        from musix.assistant.editor import edit

        keys = {f"T{i + 1}": t for i, t in enumerate(tracks)}
        with self.timings.span("llm.edit"):
            text, _ = await edit(self.agent.llm, self.cfg.lang, track_listing(keys), comment)
        return text or ""

    async def _resolve_off_loop(self, claims: list, plan: Plan) -> list:
        """``_resolve`` for the middle of a round: on a thread (it can take a second
        on a large library) and without the stage frames, which the round's final
        resolve sends once."""
        with self.timings.concurrent("resolve.library"):
            tracks, _ = await asyncio.to_thread(
                select_tracks,
                self.agent.catalog,
                list(claims),
                era=plan.filters.era,
                source_weights=self.cfg.source_weights,
            )
        return tracks

    async def _discography(
        self, plan: Plan, *, found: int, quiet: bool = False, sources=None
    ) -> list:
        """Last resort: go and read the artist's discography article.

        The failure this exists for is specific and common. "Хиты Канье после
        2020" has no page — nobody writes a listicle per artist per era — so the
        searches come back with charts, interviews and news, and the deterministic
        stage matches four tracks. Meanwhile Wikipedia has the whole singles
        discography in a table, and the era filter can do the rest itself.

        The query is built by CODE, not by the model: the artist is already
        resolved against the library, and "<artist> discography" is not a
        judgement call. Wikipedia's engine searches article titles, so it is also
        very likely to land exactly right.
        """
        artist = plan.filters.artist
        if not artist:
            return []
        artist = self._library_artist(plan) or artist

        if not quiet:
            self.sink.put("discography", artist=artist, found=found)
        logger.info(
            "[playlist] %s %s's discography",
            "speculatively reading" if quiet else f"only {found} tracks — reading",
            artist,
        )

        refs: list = []
        tried = 0
        for template in DISCOGRAPHY_TITLES:
            if tried >= self.cfg.discography_max_queries:
                break
            tried += 1
            query = template.format(artist=artist)
            hits = await asyncio.to_thread((sources or self.sources).wikipedia, query, 2, True)
            pages = await self.fetcher.fetch_many(dedupe_by_url(hits), limit=1)
            for page in pages:
                got = await asyncio.to_thread(structured_tracks, page, default_artist=artist)
                logger.info("[playlist] discography %r -> %s -> %d rows", query, page.url, len(got))
                refs += got
            if refs:
                break
            # Nothing on that page. Almost always the disambiguation stub —
            # "Kanye West discography" is three links and no table — so the next
            # spelling is tried rather than giving up.
            logger.info("[playlist] %r yielded no rows, trying the next title", query)

        if not quiet:
            self.sink.put("discography_done", queries=tried, claims=len(refs))
        return refs

    # ── selection, all of it code ─────────────────────────────────────────

    def _resolve(self, claims: list, plan: Plan) -> tuple:
        """Claims → library tracks, weighted, era-filtered, best first."""
        with self.timings.span("resolve.library"):
            tracks, missing = select_tracks(
                self.agent.catalog,
                claims,
                era=plan.filters.era,
                source_weights=self.cfg.source_weights,
            )
        if plan.filters.era:
            self.sink.put("era_filter", range=plan.filters.era, kept=len(tracks))
        return tracks, missing

    def _relax(self, plan: Plan, queries: list, done: int) -> Optional[list]:
        """Drop one constraint from the query TEXT (never from the filters).

        Order matters: the style word is the one that most distorts a web search
        ("спокойные хиты 80х" finds listicles about calm music, not the decade's
        hits), the era is second. Both keep filtering results afterwards — this
        only changes what we ask the internet for.
        """
        if done >= self.cfg.max_relaxations:
            return None
        drop = [plan.filters.style] if done == 0 else []
        if done == 1 and plan.filters.era:
            drop = [
                str(plan.filters.era[0]),
                str(plan.filters.era[1]),
                f"{plan.filters.era[0] // 10 * 10}s",
            ]
        drop = [d for d in drop if d]
        if not drop:
            return None
        out = []
        for query in queries:
            relaxed = query
            for token in drop:
                relaxed = _strip(relaxed, token)
            relaxed = " ".join(relaxed.split())
            if relaxed and relaxed not in out:
                out.append(relaxed)
        return out or None


SOUND_PLAYLIST_MIN = 3


def _sound_note(plan: Plan, first: int, added: int, lang: str) -> str:
    """«С гитарой нашлось 2 — остальные 6 без этого условия.» Written by code."""
    from musix.contexts.sound import query as SQ

    hard = [k for k in plan.filters.sound if k.hard]
    what = SQ.phrase(hard, lang)
    if (lang or "").lower().startswith("ru"):
        if first == 0:
            return f"Треков {what} среди них не нашлось — показываю все {added}."
        return (
            f"{what[:1].upper()}{what[1:]} нашлось {first} — остальные {added} без этого условия."
        )
    if first == 0:
        return f"None of them with {what} — showing all {added}."
    return f"Only {first} with {what}; the other {added} without it."


def _strip(text: str, token: str) -> str:
    """Remove ``token`` from ``text``, case-insensitively, as a whole phrase."""
    if not token:
        return text
    return " ".join(re.sub(re.escape(token), " ", text, flags=re.I).split())
