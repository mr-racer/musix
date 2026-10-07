import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ok, type Schemas } from "../../api/client";
import { homeQuery } from "../../api/queries";
import { BRAND_BLOBS, dusty } from "../../lib/color";
import { hoursMinutes, hoursMinutesWide, num, plural } from "../../lib/format";
import { image } from "../../lib/images";
import { fromTrack, player, usePlayer } from "../../player/engine";
import { flyToMini } from "../../player/MiniPlayer";
import { Wordmark } from "../../ui/Brand";
import { Cover } from "../../ui/Cover";
import { openAlbum } from "../../ui/Gatefold";
import { Icon } from "../../ui/icons";
import { Orb } from "../../ui/Orb";
import { QuickSearch } from "../../ui/QuickSearch";
import { Sky, type Weather } from "../../ui/Sky";
import css from "./home.module.css";

/** `localStorage.setItem("mx-sky", "snow")` shows the sky in any weather, for a look at it
 *  without waiting for the real thing (the instance's place sets the real one). */
function skyOverride(): Weather | null {
  try { const v = localStorage.getItem("mx-sky"); return v === "clear" || v === "cloudy" || v === "rain" || v === "snow" ? v : null; } catch { return null; }
}

export const Route = createFileRoute("/_app/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  component: Home,
});

/** The home (design/code/screens/home.md, mock design/reference/home): v1's composition,
 *  refined. Left, the hero: the vibe phrase, the orb of «Поток» with its caption and the
 *  wave's style under a disclosure, the вайбики as piles. Right, two paths: search (the
 *  library at once, or the assistant) and the library. At the bottom, albums to put on
 *  whole, in a plate, with the вайбик each one sounds like, and the week. A living sky
 *  over it all. One request: `GET /home`. */
function Home() {
  const home = useQuery(homeQuery).data!;
  const streaming = usePlayer((s) => s.mode === "stream" && s.index >= 0);
  const playing = usePlayer((s) => s.playing);
  const { colors, taste } = useMemo(() => {
    const vib = home.vibes.map((v) => image(v.tracks[0]?.coverImageId)?.palette?.vibrant).filter((c): c is string => !!c);
    const cs = home.vibes
      .flatMap((v) => { const p = image(v.tracks[0]?.coverImageId)?.palette; return p ? [p.vibrant, p.dominant] : []; })
      .map((c) => dusty(c)).filter((c): c is string => !!c);
    return { colors: cs.length >= 2 ? [...cs, ...BRAND_BLOBS].slice(0, 4) : BRAND_BLOBS, taste: vib.length ? vib : BRAND_BLOBS };
  }, [home]);
  const [pace, setPace] = useState(1);
  const live = streaming && playing;

  return (
    <div className={css.home}>
      <Sky weather={skyOverride() ?? home.weather?.kind ?? "clear"} taste={taste} />
      <header className={css.top}><Wordmark /></header>

      <div className={css.grid}>
        <section className={css.hero}>
          <div className={css.eyebrow}><Icon name="Bars" size={14} /> Твой вайб</div>
          <Phrase text={home.wave?.phrase ?? "Волна под твой вкус — из того, что ты слушаешь"} home={home} />
          <div className={css.orbRow}>
            <Orb playing={live} pace={pace} colors={colors} label={live ? "Поставить волну на паузу" : streaming ? "Продолжить волну" : "Включить поток"}
              onClick={() => (streaming ? player.toggle() : void player.startStream())} />
            <div className={css.orbText}>
              <div className={css.orbTitle}>{live ? "Волна играет" : streaming ? "Волна на паузе" : "Включить поток"}</div>
              <div className={css.orbSub}>{live ? "Нажми на шар, чтобы поставить на паузу" : "Волна под твой вкус, подстраивается под реакции"}</div>
              <WaveSettings onPace={setPace} />
            </div>
          </div>
          {home.vibes.length > 0 && (
            <div className={css.vibes}>
              <div className={css.caption}>Вайбики · <span>то, что держит тебя сейчас</span></div>
              <div className={css.vibeRow}>
                {home.vibes.map((v) => <Vibe key={v.id} vibe={v} />)}
              </div>
            </div>
          )}
        </section>

        <section className={css.paths}>
          <div>
            <div className={css.eyebrow}><Icon name="Search" size={13} /> Найти в библиотеке</div>
            <p className={css.pathSub}>Артист, альбом или песня, сразу из фонотеки. «ИИ» отдаёт вопрос ассистенту</p>
            <QuickSearch edge />
          </div>
          <div>
            <div className={css.eyebrowDot}>Фонотека</div>
            <Link to="/library" className={css.lib}>
              <span>
                <span className={css.libTitle}>Библиотека <Icon name="ChevronRight" size={18} /></span>
                <Counts albums={home.counts.albums} tracks={home.counts.tracks} />
              </span>
              <span className={css.fan} aria-hidden>
                {home.recentlyAdded.slice(0, 3).map((t) => <Cover key={t.id} id={t.coverImageId} size={68} radius={8} className={css.fanCover} />)}
              </span>
            </Link>
          </div>
        </section>
      </div>

      <footer className={css.bottom}>
        <Picks picks={home.albumPicks ?? []} />
        <Week pulse={home.pulse} />
      </footer>
    </div>
  );
}

/** The names in the phrase (the Latin words in a Russian sentence) lead to their artists,
 *  when the library knows them. */
const NAME = /([A-Za-z](?:[A-Za-z0-9'’.&-]*[A-Za-z0-9])?(?: [A-Z](?:[A-Za-z0-9'’.&-]*[A-Za-z0-9])?)*)/;
function Phrase({ text, home }: { text: string; home: Schemas["HomeOut"] }) {
  const ids = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of [...home.recent, ...home.recentlyAdded, ...home.vibes.flatMap((v) => v.tracks)])
      for (const a of t.artists) { m.set(a.name.toLowerCase(), a.id); const last = a.name.split(" ").at(-1); if (last && last.length > 3) m.set(last.toLowerCase(), a.id); }
    for (const p of home.albumPicks ?? []) if (p.album.albumArtist) m.set(p.album.albumArtist.name.toLowerCase(), p.album.albumArtist.id);
    return m;
  }, [home]);
  return (
    <h1 className={css.phrase} data-sky-edge="text">
      {text.split(NAME).map((part, i) => {
        const id = i % 2 ? ids.get(part.toLowerCase()) : undefined;
        return id ? <Link key={i} to="/artist/$id" params={{ id }} className={css.name}>{part}</Link> : <span key={i}>{part}</span>;
      })}
    </h1>
  );
}

function Counts({ albums, tracks }: { albums: number; tracks: number }) {
  // the counts tick up once, like a counter coming to rest
  const [k, setK] = useState(() => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 1 : 0));
  useEffect(() => {
    if (k === 1) return;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function step(n) {
      const x = Math.min(1, (n - t0) / 900);
      setK(1 - Math.pow(1 - x, 4));
      if (x < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = Math.round(albums * k), t = Math.round(tracks * k);
  return <span className={css.libSub}>{num(a)} {plural(albums, "альбом", "альбома", "альбомов")} · {num(t)} {plural(tracks, "трек", "трека", "треков")}</span>;
}

/** A вайбик: its covers as a little pile that spreads under the pointer. A click plays it;
 *  the top cover flies into the mini player. */
function Vibe({ vibe }: { vibe: Schemas["VibeOut"] }) {
  const pile = useRef<HTMLSpanElement>(null);
  const t = vibe.tracks, p = [t[2] ?? t[0], t[1] ?? t[0], t[0]];
  return (
    <button type="button" className={css.vstack}
      onClick={() => {
        flyToMini(pile.current?.lastElementChild as HTMLElement | null);
        void player.playTracks(vibe.tracks.map((x) => fromTrack(x, "queue", `vibe:${vibe.id}`)));
      }}>
      <span ref={pile} className={css.pile}>
        {p.map((x, i) => <Cover key={i} id={x?.coverImageId} size={50} radius={9} className={css.pileCover} />)}
      </span>
      <span className={css.vtext}>
        <b>{vibe.name ?? vibe.tracks[0]?.genre ?? "Вайб"}</b>
        <small>{t.length} {plural(t.length, "трек", "трека", "треков")}<Icon name="Play" size={10} /></small>
      </span>
    </button>
  );
}

/** «Настроить волну» opens in place under the caption; the rows below slide down with it.
 *  Inside: what to play, one of four on a track with a springing thumb; the sound, two
 *  switches. The choice is sent to the server and recolours nothing here: the orb's drops
 *  answer to the sound setting's pace. */
const KEY = "mx-wave-settings";
function WaveSettings({ onPace }: { onPace: (p: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seg = useRef<HTMLDivElement>(null);
  const presets = useQuery({ queryKey: ["presets"], queryFn: () => ok(api.GET("/api/v2/stream/presets")), staleTime: Infinity }).data ?? [];
  const [sel, setSel] = useState<{ familiarity: string; sound: string | null }>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "") as { familiarity: string; sound: string | null }; } catch { return { familiarity: "mix", sound: null }; }
  });
  useEffect(() => { onPace(sel.sound === "calm" ? 0.7 : sel.sound === "energetic" ? 1.5 : 1); }, [sel.sound, onPace]);
  const fam = presets.filter((p) => p.row === "familiarity"), snd = presets.filter((p) => p.row === "sound");

  // the thumb under the chosen preset
  useEffect(() => {
    const g = seg.current, b = g?.querySelector<HTMLElement>(`[data-id="${sel.familiarity}"]`), t = g?.querySelector<HTMLElement>("[data-thumb]");
    if (!b || !t || !b.offsetWidth) return;
    t.style.setProperty("--x", `${b.offsetLeft}px`);
    t.style.setProperty("--w", `${b.offsetWidth}px`);
  }, [sel.familiarity, open, presets]);

  async function pick(p: Schemas["PresetOut"]) {
    const next = p.row === "sound" ? { ...sel, sound: sel.sound === p.id ? null : p.id } : { ...sel, familiarity: p.id };
    setSel(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* a private window: the choice lives for the session */ }
    await ok(api.PUT("/api/v2/stream/settings", { body: next }));
    if (usePlayer.getState().mode === "stream" && usePlayer.getState().index >= 0) void player.startStream();
  }
  function toggle() {
    const el = box.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el) return setOpen((v) => !v);
    el.getAnimations().forEach((a) => a.cancel());
    if (!open) {
      setOpen(true);
      el.hidden = false;
      const h = el.scrollHeight;
      if (!reduce) el.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 420, easing: "cubic-bezier(.22,.9,.3,1)" });
    } else {
      const h = el.offsetHeight;
      const done = () => { el.hidden = true; setOpen(false); };
      if (reduce) done();
      else el.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 320, easing: "cubic-bezier(.22,.9,.3,1)" }).onfinish = done;
    }
  }
  return (
    <>
      <button type="button" className={css.pill} onClick={toggle} aria-expanded={open} aria-controls="wave-tune">
        <Icon name="Settings" size={13} /> Настроить волну <Icon name="ChevronDown" size={12} />
      </button>
      <div ref={box} id="wave-tune" className={css.tuneBox} hidden>
        <div className={css.tuner} role="group" aria-label="Настрой волны">
          <div ref={seg} className={css.seg} role="radiogroup" aria-label="Что играть">
            <span className={css.segThumb} data-thumb aria-hidden />
            {fam.map((p) => <button key={p.id} type="button" role="radio" data-id={p.id} aria-checked={sel.familiarity === p.id} className={css.segItem} onClick={() => void pick(p)}>{p.labelRu}</button>)}
          </div>
          <div className={css.sound}>
            {snd.map((p) => <button key={p.id} type="button" aria-pressed={sel.sound === p.id} className={css.chip} onClick={() => void pick(p)}>{p.labelRu}</button>)}
          </div>
        </div>
      </div>
    </>
  );
}

/** «Поставить альбом»: v1's picks (screens/picks.py), the вайбик each one sounds like as the
 *  reason. The record comes out from behind the sleeve, up and to the left into the plate's
 *  own padding; as many albums as fit whole. */
function Picks({ picks }: { picks: Schemas["AlbumPick"][] }) {
  const row = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(picks.length);
  const [cap, setCap] = useState<string | null>(null);
  useEffect(() => {
    const r = row.current;
    if (!r) return;
    const fit = () => setShown(getComputedStyle(r).gridTemplateColumns.split(" ").filter(Boolean).length);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(r);
    return () => ro.disconnect();
  }, [picks.length]);
  if (!picks.length) return <div />;
  return (
    <div className={css.plate} data-sky-edge="plate">
      <div className={css.plateHead}>
        <span className={css.caption}>Поставить альбом</span>
        <i className={css.plateSay} key={cap ?? ""}>{cap ?? "звучат как твои вайбики, но не из них"}</i>
        <Link to="/library" className={css.lnk}>Все альбомы <Icon name="ChevronRight" size={16} /></Link>
      </div>
      <div ref={row} className={css.picks} onPointerLeave={() => setCap(null)}>
        {picks.slice(0, shown).map((p) => {
          const lab = image(p.album.coverImageId)?.palette?.vibrant ?? "#b7b0a0";
          return (
            <Link key={p.album.id} to="/album/$id" params={{ id: p.album.id }} className={css.alb} style={{ ["--lab" as string]: lab }}
              onPointerEnter={() => setCap(`${p.album.trackCount} ${plural(p.album.trackCount, "трек", "трека", "треков")} · ${hoursMinutes(p.album.durationMs)}`)}
              onClick={(e) => openAlbum(e, p.album.id, p.album.coverImageId, e.currentTarget.querySelector("img"))}>
              <span className={css.sleeve}><span className={css.disc} /><Cover id={p.album.coverImageId} size={78} radius={8} className={css.sleeveCover} /></span>
              <span className={css.albText}>
                <b>{p.album.title}</b>
                <small>{p.album.albumArtist?.name ?? ""}{p.album.year ? ` · ${p.album.year}` : ""}</small>
                {p.vibeName && <em>≈ {p.vibeName}</em>}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** The week: the last seven days, today last; one number, seven bars that grow in, and a
 *  line of small readings. A bar under the pointer says its own day in place of the total. */
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"], IN = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
function Week({ pulse }: { pulse: Schemas["WeeklyPulse"] }) {
  const days = pulse.last7Ms?.length === 7 ? pulse.last7Ms : pulse.dailyMs.slice(-7);
  const total = pulse.last7PlayedMs ?? days.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...days);
  const dow = new Date().getDay();
  const [at, setAt] = useState<number | null>(null);
  const say = (i: number) => (i === 6 ? "сегодня" : i === 5 ? "вчера" : IN[(dow - (6 - i) + 7) % 7]);
  const streak = pulse.streakCurrent ?? 0;
  return (
    <div className={css.week}>
      <span className={css.caption}>За 7 дней</span>
      <div className={css.wrow}>
        <span className={css.val}>
          <span className={css.n} key={at ?? -1}>{hoursMinutesWide(at === null ? total : days[at]!)}</span>
          <small>{at === null ? "музыки" : say(at)}</small>
        </span>
        <span className={css.bars} onPointerLeave={() => setAt(null)}>
          {days.map((ms, i) => (
            <button type="button" key={i} className={css.bar + (i === 6 ? " " + css.today : "")} aria-label={`${say(i)}: ${hoursMinutesWide(ms)}`}
              onPointerEnter={() => setAt(i)} onFocus={() => setAt(i)} onBlur={() => setAt(null)}>
              <i style={{ ["--h" as string]: (ms / max).toFixed(3), ["--n" as string]: String(i) }} />{WD[(dow - (6 - i) + 7) % 7]}
            </button>
          ))}
        </span>
      </div>
      <div className={css.mets}>
        {streak > 0 && <span><b>{streak}</b> {plural(streak, "день", "дня", "дней")} подряд</span>}
        <span><b>{pulse.discoveries}</b> {plural(pulse.discoveries, "трек", "трека", "треков")} впервые</span>
        {pulse.topGenre && <span>чаще всего <b>{pulse.topGenre}</b></span>}
      </div>
    </div>
  );
}
