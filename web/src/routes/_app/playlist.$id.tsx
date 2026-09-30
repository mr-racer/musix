import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { db, rowToTrack } from "../../api/db";
import { deletePlaylist, moveItem, removeItem, renamePlaylist } from "../../api/playlists";
import { clock, plural } from "../../lib/format";
import { warmFromMirror } from "../../lib/images";
import { useLive } from "../../lib/live";
import { fromTrack, player } from "../../player/engine";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { TrackList } from "../../ui/TrackList";
import css from "./detail.module.css";

export const Route = createFileRoute("/_app/playlist/$id")({ component: Playlist });

/** A playlist from the mirror: rename, delete (typed confirm is overkill here: a second
 *  click), drag to reorder, remove a row. Edits go to the server; the mirror follows. */
function Playlist() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const data = useLive(async () => {
    const p = await db.playlists.get(id);
    const items = await db.items.where("[playlistId+position]").between([id, ""], [id, "￿"]).toArray();
    const tracks = await db.tracks.bulkGet(items.map((i) => i.trackId));
    const rows = items.map((it, i) => ({ it, t: tracks[i] })).filter((r) => r.t);
    await warmFromMirror(rows.map((r) => r.t!.coverImageId));
    return { p, rows };
  }, [id]);
  const [name, setName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  if (!data) return null;
  if (!data.p) return <p className="not-found">Плейлист не найден.</p>;
  const { p, rows } = data;
  const tracks = rows.map((r) => rowToTrack(r.t!));
  const total = rows.reduce((s, r) => s + (r.t!.durationMs || 0), 0);

  return (
    <div className={css.page}>
      <header className={css.head}>
        <span className={css.mosaic}>{tracks.slice(0, 4).map((t) => <Cover key={t.id} id={t.coverImageId} size={130} radius={0} />)}</span>
        <div className={css.headText}>
          <div className={css.eyebrow}>Плейлист</div>
          {name === null ? (
            <h1 className={css.headTitle}><button type="button" className={css.renamable} onClick={() => setName(p.name)} title="Переименовать">{p.name}</button></h1>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== p.name) void renamePlaylist(id, name.trim()); setName(null); }}>
              <input className={css.renameInput} value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={() => setName(null)} aria-label="Название плейлиста" />
            </form>
          )}
          <div className={css.headSub}>{rows.length} {plural(rows.length, "трек", "трека", "треков")} · {clock(total)}</div>
          <div className={css.actions}>
            <button type="button" className={css.cta} disabled={!rows.length} onClick={() => void player.playTracks(tracks.map((t) => fromTrack(t, "playlist", id)))}><Icon name="Play" size={14} /> Слушать</button>
            <button type="button" className={confirm ? css.dangerOn : css.ghost}
              onClick={async () => { if (!confirm) return setConfirm(true); await deletePlaylist(id); void nav({ to: "/library", search: { tab: "playlists" } }); }}
              onBlur={() => setConfirm(false)}>
              <Icon name="Trash" size={14} /> {confirm ? "Точно удалить?" : "Удалить"}
            </button>
          </div>
        </div>
      </header>
      {rows.length === 0 ? <p className={css.empty}>Пусто. Добавляй треки кнопкой «+» в плеере или на альбоме.</p> : (
        <div onDragOver={(e) => e.preventDefault()}>
          <TrackList tracks={tracks} context="playlist" contextId={id}
            trailing={(_, i) => (
              <span className={css.rowTools} draggable onDragStart={() => setDrag(i)}
                onDrop={() => { if (drag !== null && drag !== i) void moveItem(id, rows[drag]!.it.id, i === 0 ? null : rows[drag < i ? i : i - 1]!.it.id); setDrag(null); }}>
                <span className={css.handle} aria-hidden><Icon name="Drag" size={14} /></span>
                <button type="button" className={css.rowX} onClick={() => void removeItem(id, rows[i]!.it.id)} aria-label="Убрать из плейлиста"><Icon name="Close" size={14} /></button>
              </span>
            )} />
        </div>
      )}
    </div>
  );
}
