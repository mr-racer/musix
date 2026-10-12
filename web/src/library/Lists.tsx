import { Link, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { db, rowToTrack } from "../api/db";
import { createPlaylist } from "../api/playlists";
import { plural } from "../lib/format";
import { image, imageUrl, warmFromMirror } from "../lib/images";
import { useLive } from "../lib/live";
import { fromTrack, player } from "../player/engine";
import { flyToMini } from "../player/MiniPlayer";
import { Icon } from "../ui/icons";
import { YandexBadge } from "../ui/YandexBadge";
import css from "./library.module.css";

/** Playlists as plates of their own colour (the first cover's), a mosaic with gaps and the
 *  name under it; the grid fills the page (the owner: «слишком много пустого места нельзя»):
 *  columns use the width, rows the height, a card a little wider than tall when it must. */

const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const day = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };

export function Lists() {
  const lists = useLive(() => db.playlists.toArray(), [], []) ?? [];
  const covers = useLive(async () => {
    const items = await db.items.toArray();
    const tracks = new Map((await db.tracks.bulkGet([...new Set(items.map((i) => i.trackId))])).filter(Boolean).map((t) => [t!.id, t!.coverImageId]));
    const by = new Map<string, string[]>();
    for (const it of items.sort((a, b) => (a.position < b.position ? -1 : 1))) {
      const c = tracks.get(it.trackId);
      if (!c) continue;
      const arr = by.get(it.playlistId) ?? [];
      if (arr.length < 4 && !arr.includes(c)) arr.push(c);
      by.set(it.playlistId, arr);
    }
    await warmFromMirror([...by.values()].flat());
    return by;
  }, [], new Map<string, string[]>());
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [making, setMaking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = [...lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const n = shown.length + 1;

  useLayoutEffect(() => {
    const fit = () => {
      const el = box.current; if (!el) return;
      const root = getComputedStyle(document.documentElement), px = (v: string) => parseFloat(root.getPropertyValue(v)) || 0;
      const gap = 12, W = el.clientWidth, H = innerHeight - (el.getBoundingClientRect().top + window.scrollY) - px("--player-h") - px("--spec-room") - 40;
      let best: { c: number; ch: number; score: number } | null = null;
      for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c), cw = (W - gap * (c - 1)) / c;
        let ch = Math.min(cw + 60, (H - gap * (r - 1)) / r);
        if (ch < 220) ch = Math.min(cw + 60, 340); // too many to fit: square cards, the page scrolls
        if (cw / ch > 1.45) continue; // never a stretched strip
        const score = (n - (c * r - n) * 1.2) * cw * ch;
        if (!best || score > best.score) best = { c, ch, score };
      }
      best ??= { c: Math.min(n, 4), ch: 300, score: 0 };
      el.style.setProperty("--pc", String(best.c)); el.style.setProperty("--ph", `${Math.floor(best.ch)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [n]);

  const play = async (id: string, from: HTMLElement | null) => {
    const items = (await db.items.where("playlistId").equals(id).toArray()).sort((a, b) => (a.position < b.position ? -1 : 1));
    const ts = (await db.tracks.bulkGet(items.map((i) => i.trackId))).filter(Boolean).map((t) => fromTrack(rowToTrack(t!), "playlist", id));
    if (!ts.length) return;
    flyToMini(from);
    await player.playTracks(ts, 0);
  };

  return (
    <div ref={box} className={css.pwall}>
      {shown.map((p) => {
        const c = covers?.get(p.id) ?? [];
        const pal = image(c[0])?.palette;
        return (
          <Link key={p.id} to="/playlist/$id" params={{ id: p.id }} className={css.pcard} style={{ ["--tint" as string]: pal?.dominant ?? pal?.muted ?? "#2a2a32" }}>
            <span className={css.mosaic} data-n={c.length}>
              {c.map((id) => <img key={id} src={imageUrl(id, 256) ?? undefined} alt="" loading="lazy" />)}
              {p.origin === "yandex" && <YandexBadge size={34} className={css.ym} />}
            </span>
            <span className={css.pmeta}><b>{p.name}</b><small>{p.itemCount} {plural(p.itemCount, "песня", "песни", "песен")} · обновлён {day(p.updatedAt)}</small></span>
            <button type="button" className={css.play} aria-label={`Слушать «${p.name}»`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void play(p.id, e.currentTarget.closest("a")); }}>
              <Icon name="Play" size={18} />
            </button>
          </Link>
        );
      })}
      <form className={css.pcard} onClick={() => setMaking(true)}
        onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const id = await createPlaylist(name.trim()); setName(""); void nav({ to: "/playlist/$id", params: { id } }); }}>
        <span className={css.pnew}>
          <span className={css.plus}><Icon name="Plus" size={26} /></span>
          {making ? <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" aria-label="Название нового плейлиста" onBlur={() => !name && setMaking(false)} /> : "Новый плейлист"}
        </span>
      </form>
    </div>
  );
}
