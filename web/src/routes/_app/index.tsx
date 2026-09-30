import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api, ok, type Schemas } from "../../api/client";
import { homeQuery } from "../../api/queries";
import { BRAND_BLOBS, dusty } from "../../lib/color";
import { hoursMinutes, num } from "../../lib/format";
import { image, remember } from "../../lib/images";
import { fromTrack, player, usePlayer } from "../../player/engine";
import { Wordmark } from "../../ui/Brand";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import css from "./home.module.css";

export const Route = createFileRoute("/_app/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  component: Home,
});

const discoveriesQuery = {
  queryKey: ["discoveries"],
  queryFn: async () => {
    const d = await ok(api.GET("/api/v2/assistant/discoveries", { params: { query: { limit: 6 } } }));
    remember(d.images);
    return d;
  },
  staleTime: 10 * 60_000,
};

/** v1's desktop landing (golden home-desktop): the vibe line and the «Поток» orb at the
 *  left with вайбики under it; the lyrics-search and library paths at the right; the
 *  discoveries and the week's pulse along the bottom. One request: `GET /home`. */
function Home() {
  const home = useQuery(homeQuery).data!;
  const nav = useNavigate();
  const streaming = usePlayer((s) => s.mode === "stream" && s.index >= 0);
  const playing = usePlayer((s) => s.playing);
  const blobs = useMemo(() => {
    const cs = home.vibes
      .flatMap((v) => {
        const p = image(v.tracks[0]?.coverImageId)?.palette;
        return p ? [p.vibrant, p.dominant] : [];
      })
      .map((c) => dusty(c))
      .filter((c): c is string => !!c);
    return cs.length >= 2 ? [...cs, ...BRAND_BLOBS].slice(0, 4) : BRAND_BLOBS;
  }, [home]);
  const [line, setLine] = useState("");
  const vars = Object.fromEntries(blobs.map((b, i) => [`--b${i}`, b]));

  return (
    <div className={css.home} style={vars}>
      <div className={css.aurora} aria-hidden>
        {blobs.map((_, i) => <span key={i} className={css["blob" + i]} />)}
      </div>
      <header className={css.top}>
        <Wordmark />
        <div className={css.topActions}>
          <Link to="/search" className={css.round} aria-label="Поиск"><Icon name="Search" size={18} /></Link>
          <Link to="/settings" className={css.round} aria-label="Настройки"><Icon name="Settings" size={18} /></Link>
        </div>
      </header>

      <div className={css.grid}>
        <section className={css.hero}>
          <div className={css.eyebrow}><Icon name="Bars" size={14} /> Твой вайб</div>
          <h1 className={css.vibe}>{home.wave?.phrase ?? "Волна под твой вкус — из того, что ты слушаешь"}</h1>
          <div className={css.orbRow}>
            <button type="button" className={css.orb + (streaming && playing ? " " + css.orbLive : "")} aria-label={streaming && playing ? "Пауза" : "Включить поток"}
              onClick={() => (streaming ? player.toggle() : void player.startStream())}>
              <span className={css.orbSpin} />
              <span className={css.orbCore}><Icon name={streaming && playing ? "Pause" : "Play"} size={22} /></span>
            </button>
            <div className={css.orbText}>
              <div className={css.orbTitle}>{streaming ? "Волна играет" : "Включить поток"}</div>
              <div className={css.orbSub}>{streaming ? "Нажмите, чтобы поставить волну на паузу" : "Волна под ваш вкус — подстраивается под реакции"}</div>
              <WaveSettings />
            </div>
          </div>
          {home.vibes.length > 0 && (
            <div className={css.vibes}>
              <div className={css.caption}>Вайбики · <span>то, что держит тебя сейчас</span></div>
              <div className={css.vibeRow}>
                {home.vibes.map((v) => (
                  <button key={v.id} type="button" className={css.vibeChip} onClick={() => void player.playTracks(v.tracks.map((t) => fromTrack(t, "queue", `vibe:${v.id}`)))}>
                    <Cover id={v.tracks[0]?.coverImageId} size={26} radius={13} />
                    <span>{v.name ?? v.tracks[0]?.genre ?? "Вайб"}</span>
                    <Icon name="Play" size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className={css.paths}>
          <div>
            <div className={css.eyebrowAccent}>✦ Поиск по тексту</div>
            <p className={css.pathSub}>Помнишь строчку, а не название? ИИ найдёт песню по словам</p>
            <form className={css.lyricSearch} onSubmit={(e) => { e.preventDefault(); if (line.trim()) void nav({ to: "/search", search: { q: line.trim(), sections: "lyrics" } }); }}>
              <Icon name="Search" size={16} />
              <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="строчка из песни…" aria-label="Строчка из песни" />
              <span className={css.aiBadge}>ИИ</span>
            </form>
          </div>
          <div>
            <div className={css.eyebrowDot}>Фонотека</div>
            <Link to="/library" className={css.libraryCard}>
              <span>
                <span className={css.libraryTitle}>Библиотека <span aria-hidden>→</span></span>
                <span className={css.librarySub}>{num(home.counts.albums)} альбомов · {num(home.counts.tracks)} треков</span>
              </span>
              <span className={css.stack} aria-hidden>
                {home.recentlyAdded.slice(0, 3).map((t, i) => <Cover key={t.id} id={t.coverImageId} size={64} radius={8} className={css["stack" + i]} />)}
              </span>
            </Link>
          </div>
        </section>
      </div>

      <footer className={css.bottom}>
        <Discoveries />
        <Pulse pulse={home.pulse} />
      </footer>
    </div>
  );
}

function WaveSettings() {
  const [open, setOpen] = useState(false);
  const presets = useQuery({ queryKey: ["presets"], queryFn: () => ok(api.GET("/api/v2/stream/presets")), staleTime: Infinity }).data ?? [];
  const [sel, setSel] = useState<{ familiarity: string; sound: string | null }>({ familiarity: "mix", sound: null });
  async function pick(p: Schemas["PresetOut"]) {
    const next = p.row === "sound" ? { ...sel, sound: sel.sound === p.id ? null : p.id } : { ...sel, familiarity: p.id };
    setSel(next);
    await ok(api.PUT("/api/v2/stream/settings", { body: next }));
    if (usePlayer.getState().mode === "stream" && usePlayer.getState().index >= 0) void player.startStream();
  }
  return (
    <div className={css.waveSettings}>
      <button type="button" className={css.tune} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="Settings" size={13} /> Настроить волну <Icon name="ChevronDown" size={12} />
      </button>
      {open && (
        <div className={css.presets} role="group" aria-label="Настройка волны">
          {(["familiarity", "sound"] as const).map((row) => (
            <div key={row} className={css.presetRow}>
              <span className={css.presetLabel}>{row === "familiarity" ? "Что" : "Звук"}</span>
              {presets.filter((p) => p.row === row).map((p) => {
                const on = row === "sound" ? sel.sound === p.id : sel.familiarity === p.id;
                return <button key={p.id} type="button" aria-pressed={on} className={on ? css.presetOn : css.preset} onClick={() => void pick(p)}>{p.labelRu}</button>;
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Card = { kind: string; headline: string; subline?: string; badge?: string; fact?: string; track_id?: string; items?: { track_id: string; title: string; artist: string }[] };

function Discoveries() {
  const d = useQuery(discoveriesQuery).data;
  const cards = ((d?.cards ?? []) as Card[]).slice(0, 3);
  if (!cards.length) return <div />;
  return (
    <div className={css.discoveries}>
      {cards.map((c, i) => {
        const tid = c.track_id ?? c.items?.[0]?.track_id;
        const t = tid ? (d!.tracks as Record<string, Schemas["TrackOut"]>)[tid] : undefined;
        return (
          <button key={i} type="button" className={css.discovery} disabled={!t} onClick={() => t && void player.playTracks([fromTrack(t, "queue")])}>
            <span className={css.discHead}>
              <Cover id={t?.coverImageId} size={40} radius={6} />
              <span>
                <span className={css.discTitle}>{c.headline}</span>
                <span className={css.discSub}>{c.subline}</span>
              </span>
            </span>
            <span className={css.discText}>{c.fact ?? c.badge}</span>
          </button>
        );
      })}
    </div>
  );
}

const DAYS = ["п", "в", "с", "ч", "п", "с", "в"];

function Pulse({ pulse }: { pulse: Schemas["WeeklyPulse"] }) {
  const max = Math.max(1, ...pulse.dailyMs);
  return (
    <div className={css.pulse}>
      <div className={css.pulseLabel}>За эту неделю</div>
      <div className={css.pulseValue}>{hoursMinutes(pulse.playedMs)}</div>
      <div className={css.bars} aria-hidden>
        {pulse.dailyMs.map((ms, i) => (
          <span key={i} className={css.barCol}>
            <span className={css.bar} style={{ ["--h" as string]: String(ms / max) }} />
            <span>{DAYS[i]}</span>
          </span>
        ))}
      </div>
      <div className={css.pulseMeta}>{pulse.topGenre && <span className={css.dotA}>{pulse.topGenre}</span>}<span className={css.dotB}>{pulse.discoveries} треков впервые</span></div>
    </div>
  );
}
