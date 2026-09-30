"""The v1 `app.domain.models` shapes the copied assistant code builds (v1 names kept)."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SearchFilters(BaseModel):
    """Фильтры для поиска."""

    # extra="ignore" — planner LLM may still emit legacy year_range (singular);
    # silently drop unknown fields instead of raising ValidationError.
    model_config = ConfigDict(extra="ignore")

    artist: str | None = None
    # The artist as an identity rather than as a string. ``artist`` is the raw
    # tag and matching it exactly misses "Eminem feat. Dido"; every point also
    # carries ``artist_slugs`` — the slug of every participant, keyword-indexed
    # at upsert — so a caller that resolved the name can narrow the search
    # itself instead of trimming its results afterwards.
    artist_slug: str | None = None
    album: str | None = None
    genre: str | None = None

    # Decade / year-range chips. OR semantics across selected ranges.
    year_ranges: list[str] = []

    # Phase 1c — sonic descriptors. AND semantics across tags (track must carry every selected tag).
    sonic_tags: list[str] = []


class PlaylistDraft(BaseModel):
    """Playlist proposed by the playlist-builder agent (not yet persisted).

    ``track_ids`` reference library tracks the agent matched via ``get_songs``;
    ``missing`` lists songs the agent wanted but the library doesn't have —
    consumed by the recsys ``web_hits`` delegation (`_web_hits_playlist`).
    """

    title: str
    track_ids: List[str] = Field(default_factory=list)
    comment: str = ""
    missing: List[str] = Field(default_factory=list)


class AssistantSlots(BaseModel):
    """Conversation state carried by the CLIENT across turns.

    The backend is stateless (every request rebuilds what it needs), so the
    server returns these in each terminal frame and the client echoes them back
    on the next message. Merge rule is unconditional: slots always carry
    forward, freshly extracted entities overwrite. That removes any need to
    decide "is this a follow-up?" — «ещё у этого артиста» simply finds no
    artist entity and falls back to ``last_artist``.
    """

    # A plain string, not the intent literal: this is opaque client-side state
    # that both the current agent and the legacy router write, and validating it
    # would only fail a request over a word the client is echoing back to us.
    last_intent: Optional[str] = None
    last_artist: Optional[str] = None
    last_song: Optional[str] = None
    last_track_id: Optional[str] = None
    last_playlist_ids: List[str] = Field(default_factory=list)
    last_filters: Optional[SearchFilters] = None


class TrackChatResponse(BaseModel):
    """Response body for POST /chat/track-chat."""

    message: str
    web_search_used: bool = False


class TrackChatContext(BaseModel):
    """Context about the track the user is chatting about. Backend resolves
    song_facts server-side (raw, not refined) — DO NOT include facts here."""

    title: str
    artist: str
    album: str | None = None
    year: int | None = None
    genre: str | None = None
    full_lyrics: str = ""


AssistantIntent = Literal["lyrics_search", "audio_search", "playlist", "general"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantRequest(BaseModel):
    """Body for POST /assistant and /assistant/stream."""

    message: str = Field(min_length=1, max_length=1000)
    history: List[ChatMessage] = Field(default_factory=list)
    slots: AssistantSlots = Field(default_factory=AssistantSlots)

    # Set by the client when the user picked an option from a `clarify` frame:
    # routing is skipped entirely and this intent is used verbatim.
    intent: Optional[AssistantIntent] = None
    # Set when the user picked a card from a `disambiguate` frame.
    subject_track_id: Optional[str] = None
    subject_artist_slug: Optional[str] = None
    # The exact statement the user tapped ("«Runaway» сэмплирует «Expo 83»") when
    # they asked what it means. Switches the facts branch from "tell me about
    # this subject" to "explain THIS line" — a different pack, a different
    # prompt, and an honest silence when nothing explains it. See
    # ``assistant/facts_executor.explain``.
    focus_fact: Optional[str] = Field(None, max_length=600)
    # The listener tapped a card of this kind rather than typing a question.
    # Deliberately NOT a fifth AssistantIntent: the intent decides which payload
    # comes back, and this changes only how one general answer is sourced.
    focus_kind: Optional[Literal["samples"]] = None
    # A previous turn's material, returned by the client so this one can reuse
    # it. Bound server-side to the account that produced it; an expired or
    # unknown id is ignored, never refused — a stale tab must degrade into a
    # slow turn, not an error.
    context_id: Optional[str] = Field(None, max_length=64)
    # Three-valued on purpose. None means "the mode decides" (general: yes,
    # samples: no); True is the «Поискать в сети» chip. A plain False default
    # here would silently mute the web for every ordinary turn.
    allow_web: Optional[bool] = None
    # What the player is on right now — lets "расскажи про этот трек" resolve
    # with no entity in the message at all.
    now_playing_track_id: Optional[str] = None

    limit: int = Field(15, ge=1, le=40)
    lang: str = "en"
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None


class AIPlaylistStep(BaseModel):
    """One executed plan action — the frontend animates these."""

    tool: str
    query: str
    found: int


class ArtistRef(BaseModel):
    """A single participant (display name + canonical slug) — used both for
    album feat lists and per-track artist credits so each collaborator links to
    their own artist page."""

    name: str
    slug: str
    # "feat" marks a featured guest (extracted from the title or credits);
    # "main" default keeps every pre-existing serializer back-compatible.
    role: Literal["main", "feat"] = "main"


class TrackMetadata(BaseModel):
    """Метаданные трека."""

    track_id: str  # хэш file_path или UUID, стабильный между рестартами
    title: str
    # Title with feat/with credits stripped («Bangarang (ft. Sirah)» →
    # «Bangarang»); None when the raw title is already clean.
    title_display: str | None = None
    artist: str
    album: str | None = None
    year: int | None = None
    genre: str | None = None
    duration_sec: float
    file_path: str
    lyrics: str | None = None
    cover_art_path: str | None = None  # путь к обложке /covers/{track_id}.{ext}
    producer: str | None = None
    label: str | None = None
    samples: list[str] | None = None
    sampled_by: list[str] | None = None
    reaction: Literal["like", "dislike"] | None = None
    bitrate_kbps: int | None = None
    # Canonical participants derived from the raw `artist` string at index time.
    artists: list[str] | None = None
    primary_artist_slug: str | None = None
    # Aligned name+slug pairs per participant — lets the UI render each
    # collaborator as its own clickable link. Populated by serializers via
    # artist_split.artist_refs(); empty when unknown.
    artist_refs: list[ArtistRef] = Field(default_factory=list)
    # Real position in the release, from file tags — drives album track ordering.
    track_number: int | None = None
    disc_number: int | None = None


class AIPlaylistTrack(TrackMetadata):
    reason: Optional[str] = None  # why this track fits the wish (LLM, short)
    source_tool: Optional[str] = None  # which tool surfaced it


class AIPlaylistResponse(BaseModel):
    title: str
    steps: List[AIPlaylistStep]
    tracks: List[AIPlaylistTrack]


class AssistantEvidenceItem(BaseModel):
    """One numbered item of the grounding pack behind an ``answer`` payload.

    ``n`` is what the model cites and what code verified: an answer whose numbers
    do not check out never reaches this model at all. The frontend renders the
    inline ``[n]`` marks off these, and the hover shows ``text`` — which for a web
    chunk is a whole passage, not a sentence.
    """

    n: int
    kind: Literal["fact", "chunk"] = "chunk"
    text: str
    # The page title for a chunk, the fact's origin (songfacts, genius) for a fact.
    source: str = ""
    url: Optional[str] = None
    # The cross-encoder's probability for this item against the question.
    ce_prob: Optional[float] = None
    used: bool = False


class AssistantSubjectRef(BaseModel):
    """Who the answer turned out to be about, when the library could tell.

    Optional on purpose: a purely web-sourced answer has no library subject, and
    inventing one to fill a card header is how an answer about one artist ends up
    illustrated with another.
    """

    kind: Literal["artist", "album", "song"] = "artist"
    title: str
    subtitle: Optional[str] = None
    artist_slug: Optional[str] = None
    track_id: Optional[str] = None
    image_path: Optional[str] = None


class AssistantAnswerPayload(BaseModel):
    """Result payload for intent="general" — a grounded prose answer."""

    answer: str
    # False when the model's answer failed the citation check. The card then shows
    # the sources instead of a paragraph nobody can trace.
    grounded: bool = True
    iterations: int = 0
    evidence: List[AssistantEvidenceItem] = Field(default_factory=list)
    subject: Optional[AssistantSubjectRef] = None
    # Set when the turn was "explain THIS statement" rather than "tell me about
    # this subject": the statement itself, and whether anything actually explained
    # it. ``explained=False`` means the honest empty answer was served.
    focus_fact: Optional[str] = None
    explained: Optional[bool] = None
    follow_ups: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)
    # In-library counterparts of the subject's sample / interpolation / cover
    # links. Filled by the samples mode and empty everywhere else: an answer
    # about what a track is built from obviously invites playing those records,
    # and under any other answer a track list is filler.
    related_tracks: List[TrackMetadata] = Field(default_factory=list)
    # Which tap-through mode produced this. Echoed so the client can re-run the
    # SAME turn with the web switched on — without it the card would have to
    # infer the mode from the shape of the payload, and infer it wrong the first
    # time a mode grows a second use.
    focus_kind: Optional[str] = None


class AssistantFactItem(BaseModel):
    """One numbered item of the grounding pack, echoed to the UI as a chip.

    ``n`` matches the [n] index the LLM cites in ``used`` — the frontend
    highlights exactly the facts the answer leaned on.
    """

    n: int
    text: str
    source: Literal["facts", "bio", "credits", "gems", "lyrics", "catalog", "web"] = "facts"
    used: bool = False


class AssistantFactsPayload(BaseModel):
    """Result payload for intent="facts"."""

    subject_kind: Literal["artist", "album", "song"]
    subject_title: str
    subject_subtitle: Optional[str] = None
    artist_slug: Optional[str] = None
    track_id: Optional[str] = None
    image_path: Optional[str] = None
    answer: str
    # False when the LLM answer failed code verification and the deterministic
    # "here's what is known" fact rendering was served instead.
    grounded: bool = True
    web_search_used: bool = False
    # Set when the turn was "explain THIS statement" rather than "tell me about
    # this subject": the statement itself, and whether anything actually
    # explained it. ``explained=False`` means the honest empty answer was served
    # — nothing was found and nothing was invented to fill the gap.
    focus_fact: Optional[str] = None
    explained: Optional[bool] = None
    items: List[AssistantFactItem] = Field(default_factory=list)
    # The facts the answer's inline [n] marks actually point at, renumbered in
    # code to 1..K by first appearance — the «Источники» spoiler renders these
    # verbatim. Distinct from ``items`` (the whole pack) and from ``used``
    # (the model's claim): only marks that survived in the TEXT count.
    sources: List[AssistantFactItem] = Field(default_factory=list)
    # Model-written next questions (sanitized in code, ≤3). Empty when the
    # answer came from the deterministic fallback or the model wrote none.
    follow_ups: List[str] = Field(default_factory=list)
    # In-library counterparts of the subject's sample/interpolation/cover
    # links — the only track suggestions that belong under a facts answer.
    related_tracks: List[TrackMetadata] = Field(default_factory=list)


class AssistantClarifyOption(BaseModel):
    intent: AssistantIntent
    label: str


class AssistantSubjectOption(BaseModel):
    """One candidate subject for the facts intent (a `disambiguate` frame)."""

    kind: Literal["artist", "album", "song"]
    title: str
    subtitle: Optional[str] = None
    track_id: Optional[str] = None
    artist_slug: Optional[str] = None
    cover_art_path: Optional[str] = None


class AssistantResponse(BaseModel):
    """Terminal payload — the non-streaming twin of the final NDJSON frame.

    Exactly one of ``search``/``playlist``/``answer`` is set, matching ``intent``:
    ``lyrics_search`` fills ``search``, ``playlist`` and ``audio_search`` both
    fill ``playlist`` (a list to play and save either way), ``general`` fills
    ``answer``. Deliberately NOT a merged union: they render as different card
    types, and flattening them is what makes the UX muddy.
    """

    intent: Optional[AssistantIntent] = None
    human: str = ""
    slots: AssistantSlots = Field(default_factory=AssistantSlots)
    # Handle on this turn's material, for a follow-up to reuse. Lives for
    # ``CONTEXT_TTL`` seconds; the client echoes it back and releases it when the
    # answer is dismissed. None when the turn read nothing worth keeping.
    context_id: Optional[str] = None

    search: Optional[Dict] = None  # shape of _run_chat_core
    playlist: Optional[AIPlaylistResponse] = None
    answer: Optional[AssistantAnswerPayload] = None
    # The pre-2026-08 facts payload. Kept on the model while the old executor is
    # still in the tree; nothing fills it any more.
    facts: Optional[AssistantFactsPayload] = None

    # Set instead of a payload when routing was inconclusive.
    clarify: Optional[List[AssistantClarifyOption]] = None
    # Set instead of a payload when the facts subject was ambiguous.
    disambiguate: Optional[List[AssistantSubjectOption]] = None


class TrackChatRequest(BaseModel):
    """Request body for POST /chat/track-chat."""

    track_context: TrackChatContext
    mode: Literal["song", "lyric_explain"]
    selected_line: str | None = None  # required when mode='lyric_explain'
    history: List[ChatMessage] = []
    message: str
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    # UI language → reply language. None falls back to "match the user's message".
    lang: Optional[str] = None


class ScoreBreakdown(BaseModel):
    """Per-modality contributions to a TrackHit's final ranking score."""

    text_dense_score: Optional[float] = None  # cosine sim from sentence-transformer
    text_bm25_score: Optional[float] = None  # raw BM25 score
    audio_score: Optional[float] = None  # cosine sim from CLAP
    final_score: float  # combined score used for ranking
    weights: Dict[str, float] = Field(default_factory=dict)


class TrackHit(BaseModel):
    """Результат поиска с трек-метаданными, score и matched_on."""

    track: TrackMetadata
    score: float
    matched_on: Literal["lyrics", "audio", "hybrid"] = "lyrics"
    lyrics: str | None = None  # выдержка из лирики для lyrics-поиска
    matched_line: str | None = (
        None  # строка лирики с максимальным перекрытием с запросом (подсветка в UI)
    )
    artist_facts: str | None = None  # interesting facts about the artist
    song_facts: str | None = None  # interesting facts about the song
    score_breakdown: Optional[ScoreBreakdown] = None
