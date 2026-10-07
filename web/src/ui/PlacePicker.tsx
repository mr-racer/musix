import { useEffect, useRef, useState } from "react";
import { api, ok, type Schemas } from "../api/client";
import { Icon } from "./icons";
import css from "./PlacePicker.module.css";

export type Place = { name: string; country?: string | null; admin?: string | null; lat: number; lon: number };

/** The city the home's sky follows (design/code/screens/home.md): asked at the first run
 *  and in the settings. Typing asks the server's geocoding (`/weather/places`); a pick
 *  hands the place up. Nothing chosen means Istanbul. */
export function PlacePicker({ value, onChange, autoFocus, compact }: {
  value: Place | null;
  onChange: (p: Place | null) => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Schemas["PlaceOut"][]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) { setHits([]); return; }
    let dead = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const got = await ok(api.GET("/api/v2/weather/places", { params: { query: { q: words } } }));
        if (!dead) { setHits(got); setOpen(true); }
      } catch { if (!dead) setHits([]); }
      finally { if (!dead) setBusy(false); }
    }, 280);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const label = (p: Place) => [p.name, p.admin, p.country].filter(Boolean).join(", ");
  return (
    <div ref={box} className={css.picker + (compact ? " " + css.compact : "")}>
      {value ? (
        <span className={css.chosen}>
          <span className={css.chosenName}>{label(value)}</span>
          <button type="button" className={css.clear} onClick={() => onChange(null)} aria-label="Убрать город" title="Убрать город"><Icon name="Close" size={14} /></button>
        </span>
      ) : (
        <span className={css.field}>
          <Icon name="Search" size={14} />
          <input value={q} autoFocus={autoFocus} placeholder="Стамбул" aria-label="Город для погоды" autoComplete="off" spellCheck={false}
            onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (hits[0]) { onChange(hits[0]); setQ(""); setOpen(false); } } else if (e.key === "Escape") setOpen(false); }} />
          {busy && <span className={css.busy} aria-hidden />}
        </span>
      )}
      {open && !value && hits.length > 0 && (
        <ul className={css.pop} role="listbox" aria-label="Города">
          {hits.map((h, i) => (
            <li key={i}>
              <button type="button" role="option" aria-selected={i === 0} className={css.hit} onClick={() => { onChange(h); setQ(""); setOpen(false); }}>
                <b>{h.name}</b><small>{[h.admin, h.country].filter(Boolean).join(", ")}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
