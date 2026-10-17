import { useEffect, useRef, useState } from "react";
import { api, mediaUrl } from "../api/client";
import { image, imageUrl, remember } from "../lib/images";
import { player } from "../player/engine";
import glass from "../ui/glass.module.css";
import { Icon } from "../ui/icons";
import css from "./artist.module.css";
import { cx } from "./Hero";
import { Win } from "./Windows";

const ROUNDS = 10, SNIPPET = 3;

/** The quiz card: a stack of the artist's covers, blurred, with the «?»; it opens the game. */
export function QuizCard({ name, covers, tracks, onOpen }: { name: string; covers: (string | null)[]; tracks: number; onOpen: (from: HTMLElement) => void }) {
  const can = tracks >= 4;
  const srcs = covers.map((c) => imageUrl(c, 256)).filter((s): s is string => !!s).slice(-3);
  return (
    <button type="button" className={css.quiz} aria-disabled={!can} onClick={(e) => { if (can) onOpen(e.currentTarget); }}>
      <span className={cx("qstack", `n${srcs.length}`)}>{srcs.map((s) => <img key={s} src={s} alt="" loading="lazy" decoding="async" />)}<b>?</b></span>
      <span>
        <span className={css.qk}>Квиз</span>
        <span className={css.qt} style={{ display: "block" }}>Угадай {name} за 3 секунды</span>
        {can ? <span className={css.qgo}><Icon name="Play" size={13} />Играть</span> : <span className={css.qd} style={{ display: "block" }}>Нужно хотя бы четыре песни артиста</span>}
      </span>
    </button>
  );
}

type Option = { option_id: string; title: string; artist?: string; cover_art_path?: string | null; year?: number | null };
type Round = { id: string; options: Option[]; audio: string | null; start: number; len: number };
type Phase = "load" | "listen" | "answer" | "reveal" | "end" | "error";

const VERDICT = (n: number) =>
  n === ROUNDS ? "Без единой ошибки. Ты явно не на разогреве."
    : n >= 8 ? "Почти идеально — уши не подводят."
    : n >= 5 ? "Неплохо: половину узнаёшь с полуслова."
    : n >= 1 ? "Есть куда расти — самое время переслушать любимое."
    : "Ни одной — зато теперь есть повод послушать.";

/** Ten rounds: three seconds of one of the artist's songs (the ring fills while it plays), four of
 *  the artist's songs to choose from; the right one lights in the page's colour, a wrong one
 *  shakes. The quiz writes no listen (server rule I-1). The player is paused for the game. */
export function QuizWindow({ from, onClose, tint, img, name, artistId }: { from: DOMRect | null; onClose: () => void; tint: string; img: string | null; name: string; artistId: string }) {
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<Phase>("load");
  const [results, setResults] = useState<boolean[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef(0);

  useEffect(() => {
    player.pause();
    const a = new Audio();
    a.preload = "auto";
    const tick = () => { if (a.currentTime >= stopAt.current) { a.pause(); setPlaying(false); } };
    a.addEventListener("timeupdate", tick);
    audio.current = a;
    return () => { a.pause(); a.removeEventListener("timeupdate", tick); a.src = ""; };
  }, []);

  const listen = (r: Round | null = round) => {
    const a = audio.current;
    if (!a || !r?.audio) return;
    const go = () => { a.currentTime = r.start; stopAt.current = r.start + r.len; setPlaying(false); requestAnimationFrame(() => setPlaying(true)); void a.play().catch(() => setPlaying(false)); };
    if (a.src !== r.audio) { a.src = r.audio; a.addEventListener("loadedmetadata", go, { once: true }); a.load(); } else go();
  };

  const next = async () => {
    setPhase("load"); setChosen(null); setRight(null); setPlaying(false);
    const res = await api.POST("/api/v2/quiz/rounds", { body: { mode: "artist_snippet", artistId, snippetSec: SNIPPET } });
    if (!res.data) {
      setError(res.response.status === 409 ? "Для квиза нужно хотя бы четыре разные песни артиста." : "Раунд не собрался — попробуй ещё раз чуть позже.");
      setPhase("error");
      return;
    }
    remember(res.data.images);
    const r: Round = { id: res.data.roundId, options: res.data.options as unknown as Option[], audio: res.data.audioUrl ? mediaUrl(res.data.audioUrl) : null, start: res.data.startSec, len: res.data.lengthSec };
    setRound(r);
    setPhase("answer");
    listen(r);
  };
  useEffect(() => { void next(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (o: Option) => {
    if (!round || phase !== "answer") return;
    setChosen(o.option_id);
    setPhase("reveal");
    audio.current?.pause(); setPlaying(false);
    const res = await api.POST("/api/v2/quiz/rounds/{round_id}/answer", { params: { path: { round_id: round.id } }, body: { optionId: o.option_id } });
    const ok = !!res.data?.correct;
    setRight(res.data?.correctOptionId ?? (ok ? o.option_id : null));
    const done = [...results, ok];
    setResults(done);
    window.setTimeout(() => { if (done.length >= ROUNDS) setPhase("end"); else void next(); }, ok ? 900 : 1500);
  };
  const again = () => { setResults([]); void next(); };
  const score = results.filter(Boolean).length;

  return (
    <Win from={from} onClose={onClose} tint={tint} img={img} title={`Угадай ${name} за 3 секунды`} sub={phase === "end" ? "Квиз окончен" : `Раунд ${Math.min(results.length + 1, ROUNDS)} из ${ROUNDS}`} narrow>
      <div className={css.qbody}>
        <div className={css.qpips} aria-hidden>
          {Array.from({ length: ROUNDS }, (_, i) => <i key={i} className={cx(results[i] === true && "ok", results[i] === false && "no", i === results.length && phase !== "end" && "cur")} />)}
        </div>
        {phase === "error" && <div className={css.qmsg}>{error}</div>}
        {phase === "end" && (
          <div className={css.qend}>
            <div className={css.score}>{score}<small> из {ROUNDS}</small></div>
            <p>{VERDICT(score)}</p>
            <div className={css.acts}>
              <button type="button" className={cx("btn", "play")} onClick={again}><Icon name="Retry" size={16} />Ещё раз</button>
            </div>
          </div>
        )}
        {(phase === "answer" || phase === "reveal" || phase === "load") && (
          <>
            <div className={css.qstage}>
              <button type="button" className={cx("listen", glass.lg, playing && "playing")} style={{ ["--len" as string]: `${round?.len ?? SNIPPET}s` }} onClick={() => listen()} aria-label="Послушать ещё раз" disabled={!round}>
                <svg className={css.ring} viewBox="0 0 96 96" aria-hidden><circle className={css.tr} cx="48" cy="48" r="46" /><circle className={css.fl} cx="48" cy="48" r="46" /></svg>
                <Icon name={playing ? "Pause" : "Play"} size={26} />
              </button>
              <div className={css.qhint}><b>{phase === "load" ? "Ставлю пластинку…" : "Что это за песня?"}</b><span>Три секунды — и выбирай. Нажми на круг, чтобы послушать ещё раз.</span></div>
            </div>
            <div className={css.qopts}>
              {(round?.options ?? []).map((o) => {
                const src = imageUrl(o.cover_art_path ?? null, 96) ?? (o.cover_art_path && image(o.cover_art_path) ? null : null);
                const st = phase === "reveal" ? (o.option_id === right ? "right" : o.option_id === chosen ? "wrong" : "dim") : null;
                return (
                  <button key={o.option_id} type="button" className={cx("qopt", st)} disabled={phase !== "answer"} onClick={() => void answer(o)}>
                    {src ? <img src={src} alt="" /> : <span className={css.nocover} />}
                    <span><b>{o.title}</b>{o.year ? <small>{o.year}</small> : null}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Win>
  );
}
