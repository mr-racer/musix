import { useState } from "react";
import { addToPlaylist, createPlaylist } from "../api/playlists";
import { db } from "../api/db";
import { useLive } from "../lib/live";
import css from "./AddToPlaylist.module.css";
import { controls } from "./controls";

/** «+»: the track into a playlist, or into a new one. */
export function AddToPlaylist({ trackIds, onDone }: { trackIds: string[]; onDone: () => void }) {
  const lists = useLive(() => db.playlists.toArray(), [], []) ?? [];
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch {
      setError("Не получилось — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={css.menu} role="dialog" aria-label="Добавить в плейлист">
      <div className={css.head}>В плейлист</div>
      <ul className={css.list}>
        {lists.sort((a, b) => a.name.localeCompare(b.name, "ru")).map((p) => (
          <li key={p.id}>
            <button type="button" disabled={busy} className={css.row} onClick={() => run(() => addToPlaylist(p.id, trackIds))}>
              <span>{p.name}</span>
              <span className={css.count}>{p.itemCount}</span>
            </button>
          </li>
        ))}
      </ul>
      <form className={css.new} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(async () => addToPlaylist(await createPlaylist(name.trim()), trackIds)); }}>
        <input className={controls.field} placeholder="Новый плейлист" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название нового плейлиста" />
        <button type="submit" className={controls.ghost} disabled={busy || !name.trim()}>Создать</button>
      </form>
      {error && <div className={controls.error}>{error}</div>}
    </div>
  );
}
