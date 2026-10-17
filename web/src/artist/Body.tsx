import { useMemo, useRef, useState } from "react";
import type { Schemas } from "../api/client";
import { db, rowToTrack } from "../api/db";
import { imageUrl } from "../lib/images";
import { fromTrack, player } from "../player/engine";
import { flyToMini } from "../player/MiniPlayer";
import { openAlbum } from "../ui/Gatefold";
import { Icon } from "../ui/icons";
import css from "./artist.module.css";
import { cx } from "./Hero";
import { freq, LEVELS, pl, type level, type Model } from "./model";
import { useSeen } from "./Timeline";

type Track = Schemas["TrackOut"];

/** «Ты и …» — the collection (the owner's pick of four, 2026-10-16): the albums as a collector's
 *  album, each cover coloured in as far as it has been heard (a water line where the colour
 *  stops, a metal check on a finished one); the level in its metal, how much is heard, how
 *  often the artist is on the air; what is under the pointer is said in the caption line. */
export function You({ m, lv }: { m: Model; lv: ReturnType<typeof level> }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [say, setSay] = useState<{ t: string; y: number | null; heard: number; n: number } | null>(null);
  const f = freq(m.you);
  const n = m.albums.length;
  const cols = n <= 8 ? Math.max(n, 4) : Math.ceil(n / 2);
  return (
    <div ref={ref} className={cx("you", seen && "seen", say && "hov")}>
      <div className={css.top2}>
        <div className={css.lvw}>
          <div className={css.lvn}>{lv.n}</div>
          <div className={css.pips} aria-label={`Уровень ${lv.k + 1} из 5: ${lv.n}`}>
            {LEVELS.map((L, j) => <i key={L.n} className={cx(j <= lv.k && "got", j === lv.k && "cur")} style={{ ["--m" as string]: L.m }} title={L.n} />)}
          </div>
        </div>
        <div className={css.knum}><b>{m.you.heardTracks}<small>/{m.tracks}</small></b><span>{pl.songsOf(m.tracks)} услышано</span></div>
        <div className={css.fq} title={f.s}>
          <span className={css.sig} aria-hidden>{[1, 2, 3, 4, 5].map((k) => <i key={k} className={cx(k <= f.bars && "on")} style={{ ["--k" as string]: k }} />)}</span>
          <div><b>{f.n}</b><span>{f.s}</span></div>
        </div>
      </div>
      <div className={css.covers} style={{ ["--cols" as string]: cols }}>
        {m.albums.map((al, i) => <Cover key={al.id} al={al} i={i} onSay={setSay} />)}
      </div>
      <div className={css.cap} aria-live="polite">
        <span className={css.h}>{say && <><b>{say.t}</b>{say.y ? ` · ${say.y}` : ""} · {say.heard} из {say.n} {pl.songsOf(say.n)}{say.heard >= say.n ? " — весь" : ""}</>}</span>
      </div>
      <div className={css.nx2}>
        <span className={css.bar} style={{ ["--p" as string]: lv.p.toFixed(3) }}><i /></span>
        {lv.need ? <span>до <b>«{lv.need.to}»</b> — {lv.need.rest}</span> : <span><b>Легенда</b> — выше только сцена</span>}
      </div>
    </div>
  );
}

function Cover({ al, i, onSay }: { al: Model["albums"][number]; i: number; onSay: (v: { t: string; y: number | null; heard: number; n: number } | null) => void }) {
  const el = useRef<HTMLButtonElement>(null);
  const p = al.n ? al.heard / al.n : 0;
  const src = imageUrl(al.cover, 256);
  return (
    <button ref={el} type="button" className={cx("cv2", p >= 1 && "full", p === 0 && "none")} style={{ ["--p" as string]: p.toFixed(3), ["--i" as string]: i }}
      aria-label={`${al.clean}: ${al.heard} из ${al.n}`}
      onPointerEnter={() => onSay({ t: al.clean, y: al.year, heard: al.heard, n: al.n })} onPointerLeave={() => onSay(null)}
      onFocus={() => onSay({ t: al.clean, y: al.year, heard: al.heard, n: al.n })} onBlur={() => onSay(null)}
      onClick={(e) => openAlbum(e as unknown as React.MouseEvent, al.id, al.cover, el.current)}>
      {src ? <><img className={css.g} src={src} alt="" loading="lazy" decoding="async" /><img className={css.c} src={src} alt="" loading="lazy" decoding="async" /></> : <span className={css.nocover} />}
      <i className={css.ln} />
      {p >= 1 && <i className={css.ok}><Icon name="Check" size={11} /></i>}
    </button>
  );
}

/** «А ты знал»: one fact at a time in a box of stable height; the next develops in place. */
export function Facts({ facts }: { facts: string[] }) {
  const [i, setI] = useState(0);
  const many = facts.length > 1;
  const next = () => { if (many) setI((x) => (x + 1) % facts.length); };
  return (
    <div className={cx("facts", !many && "one")} role={many ? "button" : undefined} tabIndex={many ? 0 : undefined} aria-label={many ? "Следующий факт" : undefined}
      onClick={next} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); } }}>
      <div className={css.fh}>
        <span className={css.fk}>А ты знал</span>
        {many && <><span className={css.fn}><b key={i}>{i + 1}</b> / {facts.length}</span><span className={css.nxt}><Icon name="ChevronRight" size={15} /></span></>}
      </div>
      <div className={css.fx}>{facts.map((f, j) => <p key={j} className={cx(j === i && "on")}>{f}</p>)}</div>
    </div>
  );
}

/** The most played songs in two columns; «Все N песен» unfolds every song from the mirror. */
export function Songs({ id, top, plays, total, heard }: { id: string; top: Track[]; plays: Record<string, number>; total: number; heard: number }) {
  const [all, setAll] = useState<Track[] | null>(null);
  const first = useMemo(() => top.slice(0, 8), [top]);
  const list = all ?? first;
  const max = Math.max(1, ...first.map((t) => plays[t.id] ?? 0));
  const unfold = async () => {
    if (all) { setAll(null); return; }
    const rows = await db.tracks.where("artistIds").equals(id).toArray();
    const rank = new Map(top.map((t, i) => [t.id, i]));
    const rest = rows.filter((r) => !rank.has(r.id)).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (a.album ?? "").localeCompare(b.album ?? "") || (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 0) - (b.trackNo ?? 0));
    setAll([...top, ...rest.map(rowToTrack)]);
  };
  const play = (i: number, from: HTMLElement) => {
    flyToMini(from);
    void player.playTracks(list.map((t) => fromTrack(t, "artist", id)), i);
  };
  return (
    <section className={css.songs}>
      <h2 className={css.h2}>Слушаешь чаще всего {heard > 0 && <small>{heard} {heard % 10 >= 2 && heard % 10 <= 4 && (heard % 100 < 12 || heard % 100 > 14) ? "раза" : "раз"}</small>}</h2>
      <div className={css.rows}>
        {list.map((t, i) => {
          const n = plays[t.id] ?? 0;
          const src = imageUrl(t.coverImageId, 96);
          return (
            <button key={t.id} type="button" className={cx("row", i >= first.length && "late")} style={{ ["--j" as string]: i - first.length }} onClick={(e) => play(i, e.currentTarget.querySelector("span") as HTMLElement)}>
              <span className={css.n}>{i + 1}</span>
              <span className={css.cv}>{src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className={css.nocover} />}<Icon name="Play" size={16} /></span>
              <span className={css.tt}><b>{t.titleDisplay ?? t.title}</b><span>{t.album ?? ""}</span></span>
              <span className={css.pc}>{n > 0 && <><i style={{ ["--p" as string]: (n / max).toFixed(3) }} />{n}</>}</span>
            </button>
          );
        })}
      </div>
      {total > first.length && (
        <button type="button" className={cx("more", all && "open")} onClick={() => void unfold()}>
          {all ? "Свернуть" : `Все ${total} ${pl.songs(total)}`}<Icon name="ChevronRight" size={14} />
        </button>
      )}
    </section>
  );
}
