import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { contextQuery } from "../../api/queries";
import { clock, plural } from "../../lib/format";
import { image } from "../../lib/images";
import { player, usePlayer } from "../../player/engine";
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
    </div>
  );
}

function Playing({ trackId }: { trackId: string }) {
  const s = usePlayer();
  const item = s.queue[s.index]!;
  const ctx = useQuery(contextQuery(trackId)).data;
  const [side, setSide] = useState<"song" | "artist" | "lyrics">("song");
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
          <button type="button" className={css.flank} onClick={() => void player.prev()} aria-label="Предыдущий"><Icon name="ChevronLeft" size={22} /></button>
          <button type="button" className={css.coverBtn + (s.playing ? "" : " " + css.paused)} onClick={() => player.toggle()} aria-label={s.playing ? "Пауза" : "Играть"}>
            <Cover id={item.coverImageId} size={440} radius={18} eager alt={item.album ?? item.title} className={css.cover} />
          </button>
          <button type="button" className={css.flank} onClick={() => void player.next()} aria-label="Следующий"><Icon name="ChevronRight" size={22} /></button>
        </div>
        <h1 className={css.title}>{item.title}</h1>
        {item.artistId ? <Link to="/artist/$id" params={{ id: item.artistId }} className={css.artist}>{item.artist} <Icon name="ChevronDown" size={14} /></Link> : <span className={css.artist}>{item.artist}</span>}
        <p className={css.album}>{[item.album, ctx?.track.year].filter(Boolean).join(" · ")}</p>
        {line && <p className={css.fact}>{line}</p>}
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
          <button type="button" className={css.act + (side === "lyrics" ? " " + css.on : "")} onClick={() => setSide(side === "lyrics" ? "song" : "lyrics")} aria-label="Текст" aria-pressed={side === "lyrics"}><Icon name="Lyrics" /></button>
          <button type="button" className={css.act} onClick={() => player.shuffleUpcoming()} disabled={s.mode === "stream"} aria-label="Перемешать очередь" title={s.mode === "stream" ? "В «Потоке» порядок ведёт волна" : "Перемешать очередь"}><Icon name="Shuffle" /></button>
          <Volume />
        </div>
        {lossless && <div className={css.lossless} title={[s.codec?.toUpperCase(), ctx?.audio.sampleRate && `${ctx.audio.sampleRate / 1000} кГц`, ctx?.audio.bitDepth && `${ctx.audio.bitDepth} бит`].filter(Boolean).join(" · ")}><LosslessMark /> Lossless</div>}
        {s.error && <p className={css.error} role="status">{s.error}</p>}
      </section>

      <section className={css.right} aria-label="О треке и очередь">
        <div className={css.tabs} role="tablist">
          {(["song", "artist", "lyrics"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={side === t} className={side === t ? css.tabOn : css.tab} onClick={() => setSide(t)}>
              {{ song: "Песня", artist: "Артист", lyrics: "Текст" }[t]}
            </button>
          ))}
        </div>
        <div className={css.panel}>
          {side === "lyrics" ? <Lyrics lyrics={ctx?.lyrics ?? null} positionMs={s.positionMs} onSeek={(ms) => player.seek(ms)} />
            : <Facts facts={side === "song" ? k?.songFacts ?? [] : k?.artistFacts ?? []} empty={side === "song" ? "О песне пока ничего не известно" : "Об артисте пока ничего не известно"} />}
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
        <span className={css.labels}>{f.labels.map((l) => <span key={l} className={css.label}>{l}</span>)}</span>
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

function Lyrics({ lyrics, positionMs, onSeek }: { lyrics: Schemas["LyricsOut"] | null; positionMs: number; onSeek: (ms: number) => void }) {
  const lines = useMemo(() => (lyrics?.syncedLrc ? parseLrc(lyrics.syncedLrc) : null), [lyrics]);
  const box = useRef<HTMLDivElement>(null);
  const cur = lines ? lines.findLastIndex((l) => l.ms <= positionMs + 250) : -1;
  useEffect(() => {
    box.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cur]);
  if (!lyrics) return <p className={css.empty}>Текста нет</p>;
  if (!lines) return <div className={css.lyrics}>{lyrics.text.split("\n").map((l, i) => <p key={i}>{l || " "}</p>)}</div>;
  return (
    <div className={css.lyrics} ref={box}>
      {lines.map((l, i) => (
        <button key={i} type="button" data-i={i} className={i === cur ? css.lineOn : css.line} onClick={() => onSeek(l.ms)}>{l.text || "♪"}</button>
      ))}
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
