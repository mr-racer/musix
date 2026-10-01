import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { contextQuery } from "../../api/queries";
import { clock, plural } from "../../lib/format";
import { factClass } from "../../lib/facts";
import { image } from "../../lib/images";
import { player, usePlayer } from "../../player/engine";
import { DevicePicker, ElsewhereBar } from "../../player/DevicePicker";
import { Wave } from "../../player/Wave";
import { AddToPlaylist } from "../../ui/AddToPlaylist";
import { Cover } from "../../ui/Cover";
import { Icon, LosslessMark } from "../../ui/icons";
import css from "./player.module.css";

export const Route = createFileRoute("/_app/player")({ component: PlayerView });

/** v1's desktop player (golden player-desktop): the cover stage, the facts line, the wave
 *  scrubber and the action row at the left; facts, lyrics and the queue at the right. */
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

function Playing({ trackId }: { trackId: string }) {
  const s = usePlayer();
  const item = s.queue[s.index]!;
  const ctx = useQuery(contextQuery(trackId)).data;
  const [side, setSide] = useState<"song" | "artist">("song");
  const [flipped, setFlipped] = useState(false);
  const [adding, setAdding] = useState(false);
  const palette = image(item.coverImageId)?.palette;
  const k = ctx?.knowledge;
  const line = k?.vibe ?? k?.songFacts[0]?.text ?? null;
  const lossless = s.tier === "lossless" || s.tier === "lossless_compat";
  const progress = s.durationMs ? Math.min(1, s.positionMs / s.durationMs) : 0;

  return (
    <div className={css.stage} style={{ ["--amb1" as string]: palette?.dominant ?? "#1c1830", ["--amb2" as string]: palette?.accent.dark ?? "#10101a" }}>
      <section className={css.left} aria-label="Сейчас играет">
        <p className={css.hint}>Нажми на обложку, чтобы поставить на паузу</p>
        <div className={css.coverRow}>
          <button type="button" className={css.flank + (flipped ? " " + css.hidden : "")} onClick={() => void player.prev()} aria-label="Предыдущий" tabIndex={flipped ? -1 : 0}><Icon name="ChevronLeft" size={22} /></button>
          <CoverStage item={item} index={s.index} flipped={flipped} playing={s.playing} buffering={s.buffering}
            back={<LyricsBack title={item.title} lyrics={ctx?.lyrics ?? null} positionMs={s.positionMs} onSeek={(ms) => player.seek(ms)} />} />
          <button type="button" className={css.flank + (flipped ? " " + css.hidden : "")} onClick={() => void player.next()} aria-label="Следующий" tabIndex={flipped ? -1 : 0}><Icon name="ChevronRight" size={22} /></button>
        </div>
        <h1 className={css.title}>{item.title}</h1>
        {item.artistId ? <Link to="/artist/$id" params={{ id: item.artistId }} className={css.artist}>{item.artist} <Icon name="ChevronDown" size={14} /></Link> : <span className={css.artist}>{item.artist}</span>}
        <p className={css.album}>{[item.album, ctx?.track.year].filter(Boolean).join(" · ")}</p>
        {line && <p className={css.fact}><span className={css.wing} />{line.replace(/^[\s"'«“„]+|[\s"'»”]+$/g, "")}<span className={css.wing} /></p>}
        {item.reason && s.mode === "stream" && <p className={css.reason}>✦ {item.reason}</p>}
        <div className={css.scrub}>
          <span className={css.time}>{clock(s.positionMs)}</span>
          <Wave trackId={trackId} progress={progress} onSeek={(f) => player.seek(f * s.durationMs)} />
          <span className={css.time}>{clock(s.durationMs)}</span>
        </div>
        <div className={css.actions}>
          <button type="button" className={css.act + (s.taste?.kind === "fire" ? " " + css.fire : "")} disabled={s.taste?.locked} onClick={() => void player.react("fire")} aria-label="Огонёк" title="Огонёк: больше такого"><Icon name="Fire" /></button>
          <button type="button" className={css.act + (s.taste?.kind === "water" ? " " + css.water : "")} disabled={s.taste?.locked} onClick={() => void player.react("water")} aria-label="Вода" title="Вода: меньше такого"><Icon name="Water" /></button>
          <span className={css.addWrap}>
            <button type="button" className={css.act} onClick={() => setAdding((v) => !v)} aria-label="В плейлист" aria-expanded={adding}><Icon name="Plus" /></button>
            {adding && <AddToPlaylist trackIds={[trackId]} onDone={() => setAdding(false)} />}
          </span>
          <button type="button" className={css.act + (flipped ? " " + css.on : "")} onClick={() => setFlipped((f) => !f)} aria-label="Текст песни" aria-pressed={flipped}><Icon name="Lyrics" /></button>
          <button type="button" className={css.act} onClick={() => player.shuffleUpcoming()} disabled={s.mode === "stream"} aria-label="Перемешать очередь" title={s.mode === "stream" ? "В «Потоке» порядок ведёт волна" : "Перемешать очередь"}><Icon name="Shuffle" /></button>
          <DevicePicker />
          <Volume />
        </div>
        <ElsewhereBar />
        {lossless && <div className={css.lossless} title={[s.codec?.toUpperCase(), ctx?.audio.sampleRate && `${ctx.audio.sampleRate / 1000} кГц`, ctx?.audio.bitDepth && `${ctx.audio.bitDepth} бит`].filter(Boolean).join(" · ")}><LosslessMark /> Lossless</div>}
        {s.error && <p className={css.error} role="status">{s.error}</p>}
      </section>

      <section className={css.right} aria-label="О треке и очередь">
        <div className={css.tabs} role="tablist">
          {(["song", "artist"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={side === t} className={side === t ? css.tabOn : css.tab} onClick={() => setSide(t)}>
              {{ song: "Песня", artist: "Артист" }[t]}
            </button>
          ))}
        </div>
        <div className={css.panel}>
          <Facts facts={side === "song" ? k?.songFacts ?? [] : k?.artistFacts ?? []} empty={side === "song" ? "О песне пока ничего не известно" : "Об артисте пока ничего не известно"} />
          {side === "song" && k && <Credits k={k} />}
        </div>
        <Queue />
      </section>
    </div>
  );
}

function Volume() {
  const [v, setV] = useState(() => player.volume());
  return (
    <label className={css.volume} title="Громкость">
      <Icon name="Volume" size={18} />
      <input type="range" min={0} max={1} step={0.01} value={v} aria-label="Громкость" onChange={(e) => { const x = Number(e.target.value); setV(x); player.setVolume(x); }} />
    </label>
  );
}

function Facts({ facts, empty }: { facts: Schemas["FactOut"][]; empty: string }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [facts]);
  if (!facts.length) return <p className={css.empty}>{empty}</p>;
  const f = facts[Math.min(i, facts.length - 1)]!;
  return (
    <div className={css.facts}>
      <div className={css.factHead}>
        <span className={css.labels}>
          {(() => {
            const c = factClass(f.labels);
            return c && <span className={css.label} style={{ ["--hue" as string]: String(c.hue) }}>{c.label}</span>;
          })()}
          {!f.confirmed && <span className={css.unconfirmed}>из открытых источников</span>}
        </span>
        <span className={css.pager}>
          <button type="button" onClick={() => setI((i - 1 + facts.length) % facts.length)} aria-label="Предыдущий факт">‹</button>
          <span>{Math.min(i, facts.length - 1) + 1} / {facts.length}</span>
          <button type="button" onClick={() => setI((i + 1) % facts.length)} aria-label="Следующий факт">›</button>
        </span>
      </div>
      <p className={css.factText}>{f.text}</p>
    </div>
  );
}

function Credits({ k }: { k: Schemas["TrackKnowledge"] }) {
  const chips = [
    ...k.producers.map((r) => ({ r, pre: "продюсер" })),
    ...k.samples.map((r) => ({ r, pre: "сэмпл" })),
    ...k.sampledBy.map((r) => ({ r, pre: "сэмплировали" })),
  ];
  if (!chips.length) return null;
  return (
    <div className={css.credits}>
      {chips.map(({ r, pre }, i) => (
        <span key={i} className={css.credit} title={r.text}><span className={css.creditPre}>{pre}</span> {r.text}</span>
      ))}
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

/** v1 `LyricsBackFace`: the lyrics on the back of the flipped cover. Synced lyrics mark
 *  the line being sung and a click on a line seeks there; the page never scrolls itself. */
function LyricsBack({ title, lyrics, positionMs, onSeek }: { title: string; lyrics: Schemas["LyricsOut"] | null; positionMs: number; onSeek: (ms: number) => void }) {
  const lines = useMemo(() => (lyrics?.syncedLrc ? parseLrc(lyrics.syncedLrc) : null), [lyrics]);
  const cur = lines ? lines.findLastIndex((l) => l.ms <= positionMs + 250) : -1;
  return (
    <div className={css.back}>
      <div className={css.backHead}>{title} · Текст</div>
      {!lyrics ? <p className={css.backEmpty}>тексты ещё не добавлены</p>
        : lines ? lines.map((l, i) => (
            <button key={i} type="button" className={i === cur ? css.lineOn : css.line} onClick={() => onSeek(l.ms)}>{l.text || " "}</button>
          ))
        : lyrics.text.split("\n").map((l, i) => (l.trim() ? <p key={i}>{l}</p> : <div key={i} className={css.gap} />))}
    </div>
  );
}

type Swap = { cover: string | null | undefined; dir: "next" | "prev"; n: number };

/** v1's cover stage:
 *  - a tilt and a shine under the pointer;
 *  - a press on click (play/pause) and a veil while buffering;
 *  - the flip to the lyrics face;
 *  - the vinyl-stack change: the old cover recedes door-style into the stack, then the new
 *    one bounces in from the side (mirrored for «назад»). */
function CoverStage({ item, index, flipped, playing, buffering, back }: { item: { trackId: string; coverImageId?: string | null; title: string; album?: string | null }; index: number; flipped: boolean; playing: boolean; buffering: boolean; back: React.ReactNode }) {
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const [pulse, setPulse] = useState(0);
  const [swap, setSwap] = useState<Swap | null>(null);
  const last = useRef({ id: item.trackId, cover: item.coverImageId, index });
  useEffect(() => {
    const l = last.current;
    if (l.id === item.trackId) return;
    last.current = { id: item.trackId, cover: item.coverImageId, index };
    if (flipped || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setSwap((s) => ({ cover: l.cover, dir: index >= l.index ? "next" : "prev", n: (s?.n ?? 0) + 1 }));
  }, [item.trackId, item.coverImageId, index, flipped]);
  useEffect(() => {
    if (!swap) return;
    const t = setTimeout(() => setSwap(null), 940);  // the entry ends at 320 + 600 ms
    return () => clearTimeout(t);
  }, [swap]);
  return (
    <div className={css.art}
      onMouseMove={(e) => {
        if (flipped) return;
        const r = e.currentTarget.getBoundingClientRect();
        setTilt({ x: (e.clientY - r.top) / r.height - 0.5, y: (e.clientX - r.left) / r.width - 0.5 });
      }}
      onMouseLeave={() => setTilt(null)}>
      {swap && (
        <div key={"out" + swap.n} className={swap.dir === "next" ? css.outNext : css.outPrev} aria-hidden>
          <Cover id={swap.cover} size={440} radius={20} className={css.cover} />
        </div>
      )}
      <div key={"in" + (swap?.n ?? 0)} className={swap ? (swap.dir === "next" ? css.inNext : css.inPrev) : css.entry}>
      <div className={css.tilt} style={{ transform: flipped || !tilt ? "none" : `rotateY(${tilt.y * 10}deg) rotateX(${-tilt.x * 10}deg) scale(1.04)` }}>
        <div className={css.flipper + (flipped ? " " + css.isFlipped : "")}>
          <button type="button" className={css.front + (playing ? "" : " " + css.paused)} tabIndex={flipped ? -1 : 0}
            onClick={() => { player.toggle(); setPulse((n) => n + 1); }} aria-label={playing ? "Пауза" : "Играть"}>
            <Cover id={item.coverImageId} size={440} radius={20} eager alt={item.album ?? item.title} className={css.cover} />
            <span className={css.veil + (buffering ? " " + css.veilOn : "")} aria-hidden><span className={css.spinner} /></span>
            {tilt && <span className={css.shine} style={{ ["--a" as string]: `${135 + tilt.y * 20}deg`, ["--p" as string]: `${48 + tilt.y * 8}%` }} />}
            {pulse > 0 && <span key={pulse} className={css.feedback} aria-hidden><Icon name={playing ? "Play" : "Pause"} size={54} /></span>}
          </button>
          <div className={css.backFace} aria-hidden={!flipped}>{back}</div>
        </div>
      </div>
      </div>
    </div>
  );
}

function Queue() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const mode = usePlayer((s) => s.mode);
  const [drag, setDrag] = useState<number | null>(null);
  const upcoming = queue.length - index - 1;
  return (
    <div className={css.queue}>
      <div className={css.queueHead}>
        {mode === "stream" ? "Поток" : "Очередь"} · {upcoming} {plural(upcoming, "трек", "трека", "треков")} впереди
      </div>
      <ol className={css.rows}>
        {queue.map((q, i) => (
          <li key={q.trackId + ":" + i} className={i === index ? css.rowOn : i < index ? css.rowPast : css.row}
            draggable={i > index} onDragStart={() => setDrag(i)} onDragOver={(e) => i > index && e.preventDefault()}
            onDrop={() => { if (drag !== null) player.move(drag, i); setDrag(null); }}>
            <button type="button" className={css.rowMain} onClick={() => void player.jump(i)}>
              <span className={css.num}>{i === index ? <Icon name="Bars" size={14} /> : i - index > 0 ? i - index : ""}</span>
              <Cover id={q.coverImageId} size={40} radius={6} />
              <span className={css.rowText}>
                <span className={css.rowTitle}>{q.title}</span>
                <span className={css.rowArtist}>{q.artist}</span>
              </span>
            </button>
            {i > index && <button type="button" className={css.rowX} onClick={() => player.remove(i)} aria-label={`Убрать «${q.title}» из очереди`}><Icon name="Close" size={14} /></button>}
          </li>
        ))}
      </ol>
    </div>
  );
}
