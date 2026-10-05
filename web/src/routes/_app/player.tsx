import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { mediaUrl, type Schemas } from "../../api/client";
import { db, rowToTrack } from "../../api/db";
import { contextQuery } from "../../api/queries";
import { factClass } from "../../lib/facts";
import { clock, plural } from "../../lib/format";
import { image, imageUrl, warmFromMirror } from "../../lib/images";
import { useLive } from "../../lib/live";
import { Combustion } from "../../player/Combustion";
import { DevicePicker, ElsewhereBar } from "../../player/DevicePicker";
import { fromTrack, player, usePlayer } from "../../player/engine";
import { SeekLine, Spectrum, spectrumQuery } from "../../player/Spectrum";
import { ask, clearChat, LINE_QUESTION, PROMPTS, TITLE_QUESTION, titlePrompt, useTrackChat } from "../../player/trackChat";
import { AddToPlaylist } from "../../ui/AddToPlaylist";
import { Cover } from "../../ui/Cover";
import { Icon, LosslessMark } from "../../ui/icons";
import css from "./player.module.css";

export const Route = createFileRoute("/_app/player")({ component: PlayerView });

/** The player «Кино» (design/code/screens/player.md; the approved probe is
 *  design/reference/player-kino). A big cover on the left, the song's text column to its
 *  right (title, links, the vibe line, credits with samples, the facts plate), the seek line
 *  with the spectrum and the controls at the bottom. The assistant and the queue open as
 *  windows. At phone width it is one screen without scrolling, with bottom sheets. */
function PlayerView() {
  const item = usePlayer((s) => s.queue[s.index]);
  if (!item) return <Idle />;
  return <Playing trackId={item.trackId} />;
}

function Idle() {
  return (
    <div className={css.idle}>
      <h1 className={css.idleTitle}>Сейчас ничего не играет</h1>
      <p>Включи «Поток» — волну под твой вкус — или выбери альбом в библиотеке.</p>
      <div className={css.idleActions}>
        <button type="button" className={css.cta} onClick={() => void player.startStream()}>Включить поток</button>
        <Link to="/library" className={css.ghost}>В библиотеку</Link>
      </div>
      <ElsewhereBar />
    </div>
  );
}

type Sheet = "queue" | "ai" | "about" | null;
/** A vibe line the model wrapped in quotes loses them; quotes inside the line stay. */
const unquote = (t: string) => t.trim().replace(/^["'«“„](.*)["'»”]$/s, "$1").trim();
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const SPRING = "cubic-bezier(.34,1.56,.64,1)"; // --mx-ease-spring, for the Web Animations below

/** The probe's icon bounce: the glyph of a button that was just switched on swells, leans
 *  and springs back. */
function pop(button: HTMLElement): void {
  const glyph = button.querySelector("svg") ?? button.firstElementChild;
  if (!glyph || reduced()) return;
  glyph.animate([{ transform: "scale(1)" }, { transform: "scale(1.45) rotate(-8deg)" }, { transform: "scale(1)" }], { duration: 520, easing: SPRING });
}

/** A cover flight is on its way to this track: the stage skips its vinyl swap for it. */
let flightFor: string | null = null;

/** Pictures fetched ahead of need (the neighbours' covers and backdrops). The elements are
 *  kept so the browser does not drop a load nobody seems to wait for. */
const warm = new Map<string, HTMLImageElement>();
function preload(...urls: (string | null | undefined)[]): void {
  for (const u of urls) {
    if (!u || warm.has(u)) continue;
    const im = new Image();
    im.decoding = "async";
    im.src = u;
    warm.set(u, im);
    if (warm.size > 24) warm.delete(warm.keys().next().value!);
  }
}

/** The shared-element flight: a thumbnail (a queue row, a sample chip) grows into the cover.
 *  The clone sits at the cover's final size and starts scaled down onto the thumbnail, so
 *  its corners read as the thumbnail's at the start and the cover's at the end, and never
 *  round on the way.
 *  Over a real link the cover's big picture is not there yet when the flight starts, so the
 *  clone is painted from the thumbnail's own pixels first (it is on screen), takes the big
 *  picture when that has decoded, and stays on the cover until the stage's own has arrived: the
 *  clone never flies blank and never lands on the previous track's cover. The thumbnail is
 *  hidden meanwhile, as in the approved probe: it is the thumbnail itself that lifts off.
 *  `go` starts the track; the flight's end is measured after it, on the new track's layout. */
function fly(from: HTMLImageElement | null | undefined, imageId: string | null | undefined, trackId: string, go: () => void): void {
  const to = document.querySelector<HTMLElement>("[data-player-cover]");
  const big = imageUrl(imageId, 760); // the variant the stage's cover shows
  const a = from?.getBoundingClientRect();
  if (!from || !a?.width || !to || !big || reduced()) return go();
  flightFor = trackId;
  const want = new URL(big, location.href).href;
  const r0 = parseFloat(getComputedStyle(from).borderTopLeftRadius) || parseFloat(getComputedStyle(from.parentElement ?? from).borderTopLeftRadius) || 8;
  // a canvas, painted from the thumbnail's own pixels: visible in its first frame whatever
  // the network and the cache do. The big picture is drawn into it once it has decoded
  const g = document.createElement("canvas");
  const paint = (pic: HTMLImageElement) => {
    if (!pic.naturalWidth) return;
    g.width = pic.naturalWidth;
    g.height = pic.naturalHeight;
    g.getContext("2d")?.drawImage(pic, 0, 0);
  };
  g.style.background = getComputedStyle(from.parentElement ?? from).backgroundColor; // the cover's placeholder colour
  paint(from);
  const hi = new Image();
  hi.src = big;
  void hi.decode().then(() => paint(hi)).catch(() => undefined);
  // first exactly over the thumbnail, which is hidden under it
  Object.assign(g.style, {
    position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`,
    transformOrigin: "0 0", zIndex: "60", pointerEvents: "none", borderRadius: `${r0}px`, boxShadow: "0 30px 70px -24px rgba(0,0,0,.75)",
  });
  document.body.appendChild(g);
  from.style.visibility = "hidden";
  go();
  // the landing place is measured once the new track is laid out: the cover may have moved
  requestAnimationFrame(() => {
    const b = to.getBoundingClientRect();
    if (!b.width) { g.remove(); from.style.visibility = ""; return; }
    const k = a.width / b.width, r = parseFloat(getComputedStyle(to).getPropertyValue("--r-cover")) || 10;
    Object.assign(g.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: `${r}px` });
    const dim = to.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0.3, transform: "scale(.94)" }], { duration: 300, easing: "cubic-bezier(.22,.9,.3,1)", fill: "forwards" });
    g.animate(
      [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${k})`, borderRadius: `${r0 / k}px` }, { transform: "none", borderRadius: `${r}px` }],
      { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
    ).onfinish = () => {
      dim.cancel();
      from.style.visibility = "";
      const landed = performance.now();
      const settle = () => {
        const pic = to.querySelector<HTMLImageElement>("button img");
        if ((pic?.complete && pic.naturalWidth > 0 && pic.currentSrc === want) || performance.now() - landed > 2000) g.remove();
        else requestAnimationFrame(settle);
      };
      settle();
    };
  });
}

/** The spectrum's height when there is room for it (the first version was 44). */
const SPEC_MAX = 104;

/** Whether the stage is at phone width (the same 780 px the styles switch at). */
function useNarrow(ref: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 780);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setNarrow(e[0]!.contentRect.width <= 780));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

function Playing({ trackId }: { trackId: string }) {
  // everything but the playhead: it moves 4 times a second, and only the seek line and the
  // lyrics follow it (<Scrub/>, <LyricsBack/>); the screen itself re-renders on real changes
  const s = usePlayer(useShallow((x) => ({
    queue: x.queue, index: x.index, mode: x.mode, playing: x.playing, buffering: x.buffering,
    tier: x.tier, codec: x.codec, taste: x.taste, error: x.error,
  })));
  const item = s.queue[s.index]!;
  const next = s.queue[s.index + 1];
  const ctx = useQuery(contextQuery(trackId)).data;
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fx, setFx] = useState<{ kind: "fire" | "water"; n: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(stage);
  const img = image(item.coverImageId);
  const k = ctx?.knowledge;
  const lossless = s.tier === "lossless" || s.tier === "lossless_compat";
  const upcoming = s.queue.length - s.index - 1;
  const before = s.queue[s.index - 1];
  const qc = useQueryClient();
  // between two tracks the engine pauses the old element before the new one plays: that is
  // buffering, not a pause, and must not flash the paused look (the blurred, dimmed cover)
  const paused = !s.playing && !s.buffering;
  const asked = useTrackChat((c) => (c.trackId === trackId ? c.messages.findLast((m) => m.line)?.line ?? null : null));

  // the neighbours' pictures and spectra, ahead of a skip: over a real link they would
  // otherwise arrive after the change (the cover swapping late, the curve rising late)
  const nextId = next?.trackId, prevId = before?.trackId, nextCover = next?.coverImageId, prevCover = before?.coverImageId;
  useEffect(() => {
    for (const id of [nextCover, prevCover]) {
      const bg = image(id)?.urls.bg;
      preload(imageUrl(id, 760), bg ? mediaUrl(bg) : null);
    }
    if (!narrow) for (const id of [nextId, prevId]) if (id) void qc.prefetchQuery(spectrumQuery(id));
  }, [nextId, prevId, nextCover, prevCover, narrow, qc]);

  // the spectrum's height: well above the line, but never into what lies over it. The room
  // is measured, because the content block is centred and its height is the song's
  useLayoutEffect(() => {
    const st = stage.current;
    if (!st || narrow) return;
    const measure = () => {
      const bar = st.querySelector<HTMLElement>('[role="slider"]');
      if (!bar) return;
      let floor = 0;
      for (const el of st.querySelectorAll<HTMLElement>("[data-above]")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) floor = Math.max(floor, r.bottom);
      }
      const room = Math.floor(bar.getBoundingClientRect().top + 9 - floor - 16);
      st.style.setProperty("--spec-h", `${room < 24 ? 0 : Math.min(SPEC_MAX, room)}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    for (const el of st.querySelectorAll("[data-above]")) ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [narrow, trackId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const accent = img?.palette?.accent.dark ?? "#c9c287";
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--mx-island-acc", accent); // the nav island's blob is outside the stage
    return () => { root.style.removeProperty("--mx-island-acc"); };
  }, [accent]);
  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => setFx(null), 2800); // the burn dies within 2.7 s
    return () => clearTimeout(t);
  }, [fx]);

  const react = (kind: "fire" | "water") => {
    if (s.taste?.locked) return;
    setFx((f) => ({ kind, n: (f?.n ?? 0) + 1 }));
    void player.react(kind);
  };
  const toggle = (which: Exclude<Sheet, null>) => setSheet((cur) => (cur === which ? null : which));
  /** A click on a lyric line: the assistant's window opens with the line quoted and explains it. */
  const askLine = (line: string) => {
    setSheet("ai");
    void ask(trackId, LINE_QUESTION, { line }); // does nothing while an answer is being written
  };
  /** The spark by the title: the window opens and explains the song's name. The window shows
   *  the short question; the model gets the longer one that asks for a short, plain answer. */
  const askTitle = () => {
    setSheet("ai");
    const chat = useTrackChat.getState();
    if (chat.trackId === trackId && chat.messages.some((m) => m.mine && m.text === TITLE_QUESTION)) return; // asked already: the answer is there
    void ask(trackId, titlePrompt(item.title), { shown: TITLE_QUESTION });
  };
  const losslessBadge = lossless && (
    <span className={css.badge} title={[s.codec?.toUpperCase(), ctx?.audio.sampleRate && `${ctx.audio.sampleRate / 1000} кГц`, ctx?.audio.bitDepth && `${ctx.audio.bitDepth} бит`].filter(Boolean).join(" · ")}>
      <LosslessMark height={10} /> Lossless
    </span>
  );
  const add = (
    <span className={css.addWrap}>
      <button type="button" className={css.ic} onClick={() => setAdding((v) => !v)} aria-label="В плейлист" aria-expanded={adding} title="В плейлист"><Icon name="Plus" /></button>
      {adding && <AddToPlaylist trackIds={[trackId]} onDone={() => setAdding(false)} />}
    </span>
  );
  const about = (
    <>
      {k && <Credits key={"credits:" + trackId} k={k} genre={ctx?.track.genre ?? null} />}
      <Facts key={"facts:" + trackId} k={k} onAsk={narrow ? undefined : () => setSheet("ai")} />
    </>
  );

  return (
    <div className={css.stage} ref={stage} data-mx-theme="dark" data-playing={!paused}
      style={{ ["--pl-acc" as string]: accent, ["--pl-acc2" as string]: img?.palette?.dominant ?? "#5664b3" }}>
      <Backdrop url={img?.urls.bg ? mediaUrl(img.urls.bg) : null} fallback={imageUrl(item.coverImageId, 96)} />

      <div className={css.frame}>
        <div className={css.topbar}>
          <button type="button" className={css.ic} onClick={() => router.history.back()} aria-label="Свернуть плеер"><Icon name="ChevronDown" /></button>
          {losslessBadge}
          <span>{add}<DevicePicker /></span>
        </div>

        <div className={css.coverRow} data-above data-flipped={flipped ? "" : undefined}>
          <button type="button" className={`${css.ic} ${css.edge}`} onClick={() => void player.prev()} aria-label="Предыдущий трек"><Icon name="ChevronLeft" /></button>
          <CoverStage item={item} index={s.index} flipped={flipped} playing={!paused} buffering={s.buffering} fx={fx}
            back={<LyricsBack title={item.title} lyrics={ctx?.lyrics ?? null} shown={flipped} asked={asked} onSeek={(ms) => player.seek(ms)} onAsk={askLine} />} />
          <button type="button" className={`${css.ic} ${css.edge}`} onClick={() => void player.next()} aria-label="Следующий трек"><Icon name="ChevronRight" /></button>
        </div>

        <div className={css.col} data-above>
        <div className={css.meta} key={trackId}>
          {/* the question mark hangs off the last word, outside the flow: it never changes how the title wraps */}
          <h1 className={css.title + (item.title.length > 15 ? " " + css.long : "")} aria-label={item.title}>
            {item.title.slice(0, item.title.lastIndexOf(" ") + 1)}
            <span className={css.titleTail}>
              {item.title.slice(item.title.lastIndexOf(" ") + 1)}
              <button type="button" className={css.titleAsk} onClick={(e) => { pop(e.currentTarget); askTitle(); }} aria-label="Что означает название песни" title="Что означает название?"><span aria-hidden>?</span></button>
            </span>
          </h1>
          <p className={css.artist}>
            {item.artistId
              ? <Link to="/artist/$id" params={{ id: item.artistId }} className={css.lnk} title="Страница артиста"><span>{item.artist}</span><Icon name="ChevronRight" size={18} /></Link>
              : item.artist}
          </p>
          <p className={css.album}>
            {item.albumId && item.album
              ? <Link to="/album/$id" params={{ id: item.albumId }} className={css.lnk} title="Страница альбома"><span>{[item.album, ctx?.track.year].filter(Boolean).join(", ")}</span><Icon name="ChevronRight" size={16} /></Link>
              : [item.album, ctx?.track.year].filter(Boolean).join(", ")}
          </p>
          {k?.vibe && <p className={css.vibe}>{unquote(k.vibe)}</p>}
          {item.reason && s.mode === "stream" && <p className={css.reason}>✦ {item.reason}</p>}
        </div>

        {!narrow && about}
        </div>

        <div className={css.note} data-above>
          <ElsewhereBar />
          {s.error && <p className={css.error} role="status">{s.error}</p>}
        </div>

        <Scrub>{!narrow && <Spectrum trackId={trackId} className={css.spectrum} />}</Scrub>

        <div className={css.bottom}>
        <div className={css.controls} role="toolbar" aria-label="Действия с треком">
          <div className={css.group}>
            <button type="button" className={`${css.ic} ${css.step} ${css.desk}`} onClick={() => void player.prev()} aria-label="Предыдущий трек"><Icon name="ChevronLeft" /></button>
            <button type="button" className={`${css.ic} ${css.step} ${css.desk}`} onClick={() => void player.next()} aria-label="Следующий трек"><Icon name="ChevronRight" /></button>
            <button type="button" className={css.ic + (s.taste?.kind === "fire" ? " " + css.fire : "")} disabled={s.taste?.locked} onClick={(e) => { pop(e.currentTarget); react("fire"); }} aria-label="Огонёк" title="Огонёк: больше такого"><Icon name="Fire" /></button>
            <button type="button" className={css.ic + (s.taste?.kind === "water" ? " " + css.water : "")} disabled={s.taste?.locked} onClick={(e) => { pop(e.currentTarget); react("water"); }} aria-label="Вода" title="Вода: меньше такого"><Icon name="Water" /></button>
            <button type="button" className={css.ic} onClick={(e) => { pop(e.currentTarget); player.shuffleUpcoming(); }} disabled={s.mode === "stream"} aria-label="Перемешать очередь" title={s.mode === "stream" ? "В «Потоке» порядок ведёт волна" : "Перемешать очередь"}><Icon name="Shuffle" /></button>
          </div>
          <div className={css.group}>
            <button type="button" className={css.ic + (flipped ? " " + css.on : "")} onClick={() => setFlipped((f) => !f)} aria-label="Текст песни" aria-pressed={flipped} title="Текст на обороте обложки"><Icon name="Lyrics" /></button>
            {narrow
              ? <button type="button" className={css.ic + (sheet === "ai" ? " " + css.on : "")} onClick={() => toggle("ai")} aria-label="Ассистент" aria-pressed={sheet === "ai"}><Icon name="Sparkles" /></button>
              : <>{add}<DevicePicker /><Volume />{losslessBadge}</>}
          </div>
        </div>

        {next && (
          <button type="button" className={css.upnext} onClick={() => toggle("queue")} aria-label="Открыть очередь">
            <small>Далее</small>
            <Cover id={next.coverImageId} size={32} radius={8} />
            <b>{next.title}</b>
            <Icon name="ChevronRight" size={18} />
          </button>
        )}
        </div>

        <div className={css.peeks}>
          <button type="button" className={css.peek} onClick={() => toggle("about")} aria-label="Открыть факты, титры и семплы">
            <span className={css.peekIcon}><Icon name="Sparkles" size={18} /></span>
            <span><small>О песне</small><b>{k?.songFacts[0]?.text ?? "Фактов пока нет"}</b></span>
            <Icon name="ChevronRight" size={18} />
          </button>
          {next && (
            <button type="button" className={css.peek} onClick={() => toggle("queue")} aria-label="Открыть очередь">
              <Cover id={next.coverImageId} size={36} radius={8} />
              <span><small>Далее</small><b>{next.title}, {next.artist}</b></span>
              <Icon name="QueueNext" size={18} />
            </button>
          )}
        </div>
      </div>

      {sheet && <button type="button" className={css.scrim} onClick={() => setSheet(null)} tabIndex={-1} aria-label="Закрыть окно" />}
      <aside className={css.win + (sheet === "queue" ? " " + css.winOpen : "")} aria-label="Очередь" aria-hidden={sheet !== "queue"}>
        <div className={css.winHead}>
          <b>{s.mode === "stream" ? "Поток" : "Очередь"}, {upcoming} {plural(upcoming, "трек", "трека", "треков")} впереди</b>
          <button type="button" className={css.ic} onClick={() => setSheet(null)} aria-label="Закрыть"><Icon name="Close" size={18} /></button>
        </div>
        <div className={css.winBody}><Queue onPick={narrow ? () => setSheet(null) : undefined} /></div>
      </aside>
      <Assistant trackId={trackId} open={sheet === "ai"} onClose={() => setSheet(null)} />
      {narrow && (
        <aside className={css.win + (sheet === "about" ? " " + css.winOpen : "")} aria-label="О песне" aria-hidden={sheet !== "about"}>
          <div className={css.winHead}>
            <b>О песне</b>
            <button type="button" className={css.ic} onClick={() => setSheet(null)} aria-label="Закрыть"><Icon name="Close" size={18} /></button>
          </div>
          <div className={css.winBody}>{about}</div>
        </aside>
      )}
    </div>
  );
}

/** The seek line with its two clocks: the only part of the screen that follows the playhead. */
function Scrub({ children }: { children?: React.ReactNode }) {
  const positionMs = usePlayer((x) => x.positionMs);
  const durationMs = usePlayer((x) => x.durationMs);
  return (
    <div className={css.scrub}>
      <span>{clock(positionMs)}</span>
      <SeekLine className={css.bar} progress={durationMs ? Math.min(1, positionMs / durationMs) : 0} durationMs={durationMs} onSeek={(f) => player.seek(f * durationMs)}>
        {children}
      </SeekLine>
      <span>{clock(durationMs)}</span>
    </div>
  );
}

/** The backdrop: the server's pre-blurred variant of the cover, stretched. The incoming
 *  picture mounts over the previous one and fades in; the old layer is pruned afterwards. */
function Backdrop({ url, fallback }: { url: string | null; fallback: string | null }) {
  const src = url ?? fallback;
  const [layers, setLayers] = useState<{ src: string; soft: boolean; n: number }[]>([]);
  useEffect(() => {
    if (!src) return;
    setLayers((l) => (l.at(-1)?.src === src ? l : [...l.slice(-1), { src, soft: !url, n: (l.at(-1)?.n ?? 0) + 1 }]));
  }, [src, url]);
  return (
    <div className={css.bg} aria-hidden>
      {layers.map((l, i) => (
        <div key={l.n} className={css.bgCover + (l.soft ? " " + css.bgSoft : "")} style={{ backgroundImage: `url(${l.src})` }}
          onAnimationEnd={() => { if (i === layers.length - 1) setLayers((x) => x.slice(-1)); }} />
      ))}
      <div className={css.tint} />
      <div className={css.grain} />
      <div className={css.shade} />
    </div>
  );
}

/** The volume: only its icon at rest. The slider slides out to the left of it on hover
 *  or keyboard focus (the icon stays where the pointer is); a click on the icon mutes. */
function Volume() {
  const [v, setV] = useState(() => player.volume());
  const loud = useRef(v || 1);
  const set = (x: number) => { setV(x); player.setVolume(x); };
  return (
    <span className={css.volume}>
      <input type="range" min={0} max={1} step={0.01} value={v} aria-label="Громкость" onChange={(e) => set(Number(e.target.value))} />
      <button type="button" className={css.ic + (v === 0 ? " " + css.muted : "")} title="Громкость" aria-label={v === 0 ? "Включить звук" : "Выключить звук"}
        onClick={() => { if (v > 0) { loud.current = v; set(0); } else set(loud.current); }}>
        <Icon name="Volume" />
      </button>
    </span>
  );
}

/** The facts plate: one control row (Песня / Артист, the category, «Спросить», the pager) and
 *  the text, clamped to three lines and opened by a click. */
function Facts({ k, onAsk }: { k: Schemas["TrackKnowledge"] | null | undefined; onAsk?: () => void }) {
  const [side, setSide] = useState<"song" | "artist">("song");
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const facts = (side === "song" ? k?.songFacts : k?.artistFacts) ?? [];
  const f = facts[Math.min(i, facts.length - 1)];
  const cls = f ? factClass(f.labels) : null;
  const page = (d: number) => { setI((n) => (Math.min(n, facts.length - 1) + d + facts.length) % facts.length); setOpen(false); };
  const all = useMemo(() => [...(k?.songFacts ?? []), ...(k?.artistFacts ?? [])].map((x) => x.text), [k]);
  return (
    <div className={css.facts}>
      <div className={css.factTop}>
        <span>
          <span className={css.seg} role="group" aria-label="Факты">
            {(["song", "artist"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={side === t} onClick={() => { setSide(t); setI(0); setOpen(false); }}>{{ song: "Песня", artist: "Артист" }[t]}</button>
            ))}
          </span>
          {cls && <span className={css.tag}>{cls.label}</span>}
          {f && !f.confirmed && <span className={css.open}>из открытых источников</span>}
        </span>
        <span>
          {onAsk && <button type="button" className={css.askLink} onClick={onAsk} title="Спросить ассистента о песне"><Icon name="Sparkles" size={18} />Спросить</button>}
          <span className={css.pager}>
            <button type="button" className={css.ic} disabled={facts.length < 2} onClick={() => page(-1)} aria-label="Предыдущий факт"><Icon name="ChevronLeft" size={18} /></button>
            <span>{facts.length ? Math.min(i, facts.length - 1) + 1 : 0} / {facts.length}</span>
            <button type="button" className={css.ic} disabled={facts.length < 2} onClick={() => page(1)} aria-label="Следующий факт"><Icon name="ChevronRight" size={18} /></button>
          </span>
        </span>
      </div>
      <div className={css.factBox}>
        {/* every fact of the track, invisible, in the same cell: the plate is as tall as the
            tallest of them, so paging and «Песня / Артист» never move the layout */}
        {all.map((text, n) => <p key={n} className={css.fact} data-sizer aria-hidden>{text}</p>)}
        {f
          ? <p key={side + i} className={css.fact + (open ? " " + css.factOpen : "")} onClick={() => setOpen((o) => !o)} title="Нажмите, чтобы развернуть или свернуть">{f.text}</p>
          : <p className={css.empty}>{side === "song" ? "О песне пока ничего не известно. Факты собираются в фоне и появятся здесь." : "Об артисте пока ничего не известно."}</p>}
      </div>
    </div>
  );
}

/** Credits: producers as links (a shared producer often means a similar sound), the genre,
 *  and the samples both ways. A sample that is in the library plays at once. */
function Credits({ k, genre }: { k: Schemas["TrackKnowledge"]; genre: string | null }) {
  if (!k.producers.length && !genre && !k.samples.length && !k.sampledBy.length) return null;
  return (
    <dl className={css.credits}>
      {k.producers.length > 0 && (
        <div>
          <dt>{k.producers.length > 1 ? "Продюсеры" : "Продюсер"}</dt>
          <dd>
            {k.producers.map((r, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {r.artistId
                  ? <Link to="/artist/$id" params={{ id: r.artistId }} className={css.lnk} title="Страница продюсера"><span>{r.text}</span></Link>
                  : <Link to="/search" search={{ q: r.text }} className={css.lnk} title="Найти в фонотеке"><span>{r.text}</span></Link>}
              </span>
            ))}
          </dd>
        </div>
      )}
      {genre && <div><dt>Жанр</dt><dd>{genre}</dd></div>}
      {k.samples.length > 0 && <Samples label="Семплирует" list={k.samples} />}
      {k.sampledBy.length > 0 && <Samples label="Её семплировали" list={k.sampledBy} />}
    </dl>
  );
}

/** Samples one way. Those in the library come first (they play at once); more than two
 *  fold behind «Ещё N». Opening, the hidden chips rise in one after another while the row
 *  grows; closing, they fade and the row draws in: the plate below slides, it does not jump. */
function Samples({ label, list }: { label: string; list: Schemas["RelationOut"][] }) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const sorted = useMemo(() => [...list].sort((a, b) => Number(!!b.trackId) - Number(!!a.trackId)), [list]);
  const rest = sorted.length - 2;
  const row = useRef<HTMLElement>(null);
  const height = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const h = el.offsetHeight, was = height.current;
    height.current = h;
    if (was === null || was === h || reduced()) return;
    el.style.overflow = "clip"; // the new chips are uncovered as the row grows
    el.animate([{ height: `${was}px` }, { height: `${h}px` }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" }).onfinish = () => { el.style.overflow = ""; };
  }, [phase]);
  const toggle = () => {
    if (phase === "closed") setPhase("open");
    else if (phase === "open" && reduced()) setPhase("closed");
    else if (phase === "open") {
      setPhase("closing");
      setTimeout(() => setPhase("closed"), 170); // the chips' fade
    }
  };
  return (
    <div>
      <dt>{label}</dt>
      <dd className={css.chips} ref={row}>
        {(phase === "closed" ? sorted.slice(0, 2) : sorted).map((r, i) => (
          <span key={(r.trackId ?? r.text) + ":" + i} className={i < 2 ? css.slot : phase === "closing" ? css.slotOut : css.slotIn} style={{ ["--n" as string]: i - 2 }}>
            <Sample r={r} />
          </span>
        ))}
        {rest > 0 && (
          <button type="button" className={css.more} aria-expanded={phase === "open"} onClick={toggle}>
            {phase === "open" ? "Свернуть" : `Ещё ${rest}`}<Icon name="ChevronDown" size={16} />
          </button>
        )}
      </dd>
    </div>
  );
}

function Sample({ r }: { r: Schemas["RelationOut"] }) {
  const row = useLive(() => (r.trackId ? db.tracks.get(r.trackId) : Promise.resolve(undefined)), [r.trackId]);
  const [, known] = useState(0);
  const art = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (row?.coverImageId) void warmFromMirror([row.coverImageId]).then(() => known((n) => n + 1));
  }, [row?.coverImageId]);
  if (!row) return <span className={css.chipOff} title="Этого трека нет в фонотеке"><span className={css.chipText}><b>{r.text}</b><small>нет в фонотеке</small></span></span>;
  const play = () => {
    const item = fromTrack(rowToTrack(row), "queue");
    fly(art.current?.querySelector<HTMLImageElement>("img"), item.coverImageId, item.trackId, () => {
      player.playNext([item]);
      void player.next();
    });
  };
  return (
    <button type="button" className={css.chip} onClick={play} aria-label={`Слушать: ${row.title}, ${row.artist}`}>
      <span className={css.chipArt} ref={art}><Cover id={row.coverImageId} size={36} radius={8} /><Icon name="Play" size={16} /></span>
      <span className={css.chipText}><b>{row.title}</b><small>{[row.artist, row.year].filter(Boolean).join(", ")}</small></span>
    </button>
  );
}

/** The assistant window: the chat about the playing track, with question templates. The
 *  answer streams in as the model writes it. */
function Assistant({ trackId, open, onClose }: { trackId: string; open: boolean; onClose: () => void }) {
  const chat = useTrackChat();
  const [text, setText] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const messages = chat.trackId === trackId ? chat.messages : [];
  const busy = chat.stage !== null;
  const send = (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setText("");
    void ask(trackId, m);
  };
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [messages.length, chat.stream, chat.stage]);
  return (
    <aside className={css.win + (open ? " " + css.winOpen : "")} aria-label="Ассистент" aria-hidden={!open}>
      <div className={css.winHead}>
        <div><b>Ассистент</b><small>О песне, которая сейчас играет</small></div>
        <span>
          {messages.length > 0 && !busy && <button type="button" className={css.ic} onClick={clearChat} aria-label="Новый разговор" title="Новый разговор"><Icon name="Trash" size={18} /></button>}
          <button type="button" className={css.ic} onClick={onClose} aria-label="Закрыть ассистента"><Icon name="Close" size={18} /></button>
        </span>
      </div>
      <div className={css.winBody} ref={body} aria-live="polite">
        {messages.length === 0 && !busy && <p className={css.hint}>Спросите о песне или артисте: о чём она, как появилась, что в ней спрятано.</p>}
        {messages.map((m, i) => (!m.mine ? <Answer key={i} text={m.text} />
          : m.line ? <blockquote key={i} className={css.quote}><small>Строчка из текста</small><p>{m.line}</p></blockquote>
          : <p key={i} className={css.mine}>{m.text}</p>))}
        {busy && (chat.stream ? <Answer text={chat.stream} typing /> : <p className={css.stageLine}>{chat.stage}</p>)}
      </div>
      <div className={css.prompts}>
        {PROMPTS.map((p) => <button key={p.label} type="button" className={css.prompt} disabled={busy} onClick={() => send(p.text)}>{p.label}</button>)}
      </div>
      <form className={css.ask} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" aria-label="Вопрос ассистенту" placeholder="Спросите о песне" tabIndex={open ? 0 : -1} />
        <button type="submit" className={css.ic} disabled={busy || !text.trim()} aria-label="Отправить" tabIndex={open ? 0 : -1}><Icon name="ChevronRight" size={18} /></button>
      </form>
    </aside>
  );
}

/** The assistant's markdown as plain blocks: paragraphs and lists, never bold. */
function Answer({ text, typing }: { text: string; typing?: boolean }) {
  const blocks = useMemo(() => {
    const out: ({ list: string[] } | { p: string })[] = [];
    for (const raw of text.replace(/\*\*|__|`/g, "").split(/\n+/)) {
      const line = raw.replace(/^(?:#+|>)\s*/, "").trim(); // no headings, no quote marks: plain blocks
      if (!line) continue;
      const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      const last = out.at(-1);
      if (item) { if (last && "list" in last) last.list.push(item[1]!); else out.push({ list: [item[1]!] }); }
      else out.push({ p: line });
    }
    return out;
  }, [text]);
  return (
    <div className={css.answer}>
      {blocks.map((b, i) => {
        const tail = typing && i === blocks.length - 1 ? " " + css.typing : "";
        return "list" in b
          ? <ul key={i}>{b.list.map((x, j) => <li key={j} className={j === b.list.length - 1 ? tail.trim() : undefined}>{x}</li>)}</ul>
          : <p key={i} className={tail.trim() || undefined}>{b.p}</p>;
      })}
    </div>
  );
}

/** `[mm:ss.xx] line` → timed lines; plain text when the lyrics are not synced. */
function parseLrc(lrc: string): { ms: number; text: string }[] {
  const out: { ms: number; text: string }[] = [];
  for (const raw of lrc.split("\n")) {
    const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?]/g)];
    const text = raw.replace(/\[[^\]]*]/g, "").trim();
    for (const t of tags) out.push({ ms: (+t[1]! * 60 + +t[2]!) * 1000 + (t[3] ? +t[3].padEnd(3, "0") : 0), text });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** The lyrics on the back of the flipped cover (v1 `LyricsBackFace` + `InlineLyricExplain`).
 *  A click on a line asks the assistant about it: the line shows a spark under the pointer
 *  and keeps it, in the accent, once asked. Synced lyrics mark the line being sung, and a
 *  small play mark in the margin starts the song from a line. The page never scrolls itself. */
function LyricsBack({ title, lyrics, shown, asked, onSeek, onAsk }: {
  title: string; lyrics: Schemas["LyricsOut"] | null; shown: boolean; asked: string | null;
  onSeek: (ms: number) => void; onAsk: (line: string) => void;
}) {
  const lines = useMemo(() => (lyrics?.syncedLrc ? parseLrc(lyrics.syncedLrc) : null), [lyrics]);
  // the line being sung: a re-render only when it changes, not on every playhead tick
  const cur = usePlayer((x) => (lines ? lines.findLastIndex((l) => l.ms <= x.positionMs + 250) : -1));
  const tab = shown ? 0 : -1;
  const row = (raw: string, i: number, sung: boolean, ms?: number) => {
    const text = raw.trim();
    if (!text) return <div key={i} className={css.gap} />;
    return (
      <div key={i} className={css.lrow}>
        {ms !== undefined && (
          <button type="button" className={css.from} tabIndex={tab} onClick={() => onSeek(ms)} aria-label="Играть с этой строчки" title="Играть с этой строчки"><Icon name="Play" size={11} /></button>
        )}
        <button type="button" tabIndex={tab} title="Спросить ассистента об этой строчке" onClick={() => onAsk(text)}
          className={css.line + (sung ? " " + css.lineOn : "") + (asked === text ? " " + css.lineAsked : "")}>
          {text}<Icon name="Sparkles" size={13} />
        </button>
      </div>
    );
  };
  return (
    <div className={css.back}>
      <div className={css.backHead}>{title} · Текст</div>
      {!lyrics ? <p className={css.backEmpty}>тексты ещё не добавлены</p>
        : lines ? lines.map((l, i) => row(l.text, i, i === cur, l.ms))
        : lyrics.text.split("\n").map((l, i) => row(l, i, false))}
    </div>
  );
}

/** The cover stage of the approved probe:
 *  - it tilts towards the cursor (8° at most) under a faint glare, and gives under a press;
 *  - a click plays / pauses: paused, the art blurs under a glass pause icon;
 *  - a veil while buffering; the flip to the lyrics face;
 *  - the vinyl change: the old cover swings away like a door, the new one lands with a
 *    bounce (mirrored for «назад»); a cover flight replaces it;
 *  - огонёк / вода burn around it.
 *  The tilt, the glare and the press are CSS variables written at most once a frame, and only
 *  while the pointer is over the cover: no React state, nothing repaints at rest. */
function CoverStage({ item, index, flipped, playing, buffering, fx, back }: {
  item: { trackId: string; coverImageId?: string | null; title: string; album?: string | null };
  index: number; flipped: boolean; playing: boolean; buffering: boolean;
  fx: { kind: "fire" | "water"; n: number } | null; back: React.ReactNode;
}) {
  const art = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const last = useRef({ id: item.trackId, cover: item.coverImageId, index });
  const shot = useRef<HTMLCanvasElement | null>(null);

  // The leaving cover is a copy of the pixels on screen, taken the moment the store changes
  // track: that is before React swaps the picture, so the old one is still in the DOM. A new
  // <img> with the same address would have to load again, and for the three or four frames
  // that takes there would be no cover at all (the owner's «исчезновение обложки»).
  useEffect(() => usePlayer.subscribe((s, p) => {
    if (s.queue[s.index]?.trackId === p.queue[p.index]?.trackId) return;
    shot.current = null;
    const box = art.current, pic = box?.querySelector<HTMLImageElement>("button img");
    if (!box || !pic?.complete || !pic.naturalWidth) return;
    const side = Math.round(box.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
    const cut = Math.min(pic.naturalWidth, pic.naturalHeight);
    const g = document.createElement("canvas");
    g.width = g.height = side;
    g.getContext("2d")?.drawImage(pic, (pic.naturalWidth - cut) / 2, (pic.naturalHeight - cut) / 2, cut, cut, 0, 0, side, side);
    shot.current = g;
  }), []);

  // before paint, so the new cover never shows in place ahead of its landing
  useLayoutEffect(() => {
    const l = last.current;
    if (l.id === item.trackId) return;
    last.current = { id: item.trackId, cover: item.coverImageId, index };
    const g = shot.current;
    shot.current = null;
    if (flightFor === item.trackId) { flightFor = null; return; }
    const box = art.current, card = tilt.current;
    if (!box || !card || flipped || reduced()) return;
    const sign = index >= l.index ? 1 : -1;
    if (g) {
      g.className = css.leaving!;
      g.style.transformOrigin = sign > 0 ? "left center" : "right center";
      box.appendChild(g);
      g.animate(
        [{ transform: "rotateY(0deg)", opacity: 1 }, { transform: `rotateY(${-68 * sign}deg) translateX(${-30 * sign}%) scale(.9)`, opacity: 0 }],
        { duration: 420, easing: "cubic-bezier(.5,0,.75,.3)", fill: "forwards" },
      ).onfinish = () => g.remove();
    }
    card.animate(
      [{ transform: `translateX(${46 * sign}%) rotate(${5 * sign}deg) scale(.86)`, opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 600, delay: 90, easing: SPRING, fill: "backwards" },
    );
  }, [item.trackId, item.coverImageId, index, flipped]);

  // the tilt and the glare follow the cursor
  useEffect(() => {
    const box = art.current, card = tilt.current;
    if (!box || !card) return;
    const rest = () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
      box.style.setProperty("--go", "0");
    };
    if (flipped || reduced() || !window.matchMedia("(hover: hover)").matches) { rest(); return; }
    let rect: DOMRect | null = null, raf = 0, px = 0.5, py = 0.5;
    const enter = () => { rect = box.getBoundingClientRect(); };
    const move = (e: PointerEvent) => {
      rect ??= box.getBoundingClientRect();
      px = (e.clientX - rect.left) / rect.width;
      py = (e.clientY - rect.top) / rect.height;
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        card.style.setProperty("--ry", `${((px - 0.5) * 8).toFixed(2)}deg`);
        card.style.setProperty("--rx", `${((0.5 - py) * 8).toFixed(2)}deg`);
        box.style.setProperty("--gx", `${(px * 100).toFixed(0)}%`);
        box.style.setProperty("--gy", `${(py * 100).toFixed(0)}%`);
        box.style.setProperty("--go", "1");
      });
    };
    const leave = () => { rect = null; cancelAnimationFrame(raf); raf = 0; rest(); };
    box.addEventListener("pointerenter", enter);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerleave", leave);
    return () => {
      box.removeEventListener("pointerenter", enter);
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, [flipped]);

  const press = (v: string) => tilt.current?.style.setProperty("--press", v);
  return (
    <div className={css.art} ref={art} data-player-cover data-paused={playing ? undefined : ""} data-flipped={flipped ? "" : undefined}
      onPointerDown={() => { if (!flipped) press(".96"); }} onPointerUp={() => press("1")} onPointerLeave={() => press("1")} onPointerCancel={() => press("1")}>
      {fx && <Combustion key={fx.n} kind={fx.kind} />}
      <div className={css.tilt} ref={tilt}>
        <div className={css.flipper + (flipped ? " " + css.isFlipped : "")}>
          <button type="button" className={css.front + (playing ? "" : " " + css.paused)} tabIndex={flipped ? -1 : 0}
            onClick={() => player.toggle()} aria-label={playing ? "Пауза" : "Играть"}>
            <Cover id={item.coverImageId} size={380} radius={10} fresh alt={item.album ?? item.title} className={css.cover} />
            <span className={css.veil + (buffering ? " " + css.veilOn : "")} aria-hidden><span className={css.spinner} /></span>
            <span className={css.glare} aria-hidden />
          </button>
          <div className={css.backFace} aria-hidden={!flipped}>{back}</div>
        </div>
      </div>
      <span className={css.pauseGlass} aria-hidden><Icon name="Pause" size={44} /></span>
    </div>
  );
}

function Queue({ onPick }: { onPick?: () => void }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <ol className={css.rows}>
      {queue.map((q, i) => (
        <li key={q.trackId + ":" + i} className={i === index ? css.rowOn : i < index ? css.rowPast : css.row}
          draggable={i > index} onDragStart={() => setDrag(i)} onDragOver={(e) => i > index && e.preventDefault()}
          onDrop={() => { if (drag !== null) player.move(drag, i); setDrag(null); }}>
          <button type="button" className={css.rowMain} onClick={(e) => {
            if (i === index) return;
            fly(e.currentTarget.querySelector<HTMLImageElement>("img"), q.coverImageId, q.trackId, () => {
              void player.jump(i);
              onPick?.();
            });
          }}>
            <span className={css.num}>{i === index ? <span className={css.eq} aria-hidden><i /><i /><i /></span> : i - index > 0 ? i - index : ""}</span>
            <Cover id={q.coverImageId} size={44} radius={10} />
            <span className={css.rowText}>
              <span className={css.rowTitle}>{q.title}</span>
              <span className={css.rowArtist}>{q.artist}</span>
            </span>
          </button>
          {i > index && <button type="button" className={css.rowX} onClick={() => player.remove(i)} aria-label={`Убрать «${q.title}» из очереди`}><Icon name="Close" size={14} /></button>}
        </li>
      ))}
    </ol>
  );
}
