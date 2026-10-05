import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { albumQuery } from "../../api/queries";
import { clock, plural } from "../../lib/format";
import { image } from "../../lib/images";
import { fromTrack, player } from "../../player/engine";
import { AddToPlaylist } from "../../ui/AddToPlaylist";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { TrackList } from "../../ui/TrackList";
import css from "./detail.module.css";

export const Route = createFileRoute("/_app/album/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(albumQuery(params.id)),
  component: Album,
});

/** An album in the player's language: the cover in its own ambient light, the play and
 *  shuffle actions, the numbered tracks (album gain applies: context `album`). */
function Album() {
  const { id } = Route.useParams();
  const { album, tracks } = useQuery(albumQuery(id)).data!;
  const [adding, setAdding] = useState(false);
  const pal = image(album.coverImageId)?.palette;
  const items = tracks.map((t) => fromTrack(t, "album", id));
  const shuffle = () => void player.playTracks([...items].sort(() => Math.random() - 0.5));
  return (
    <div className={css.page} style={{ ["--amb1" as string]: pal?.dominant ?? "#1c1830", ["--amb2" as string]: pal?.accent.dark ?? "#10101a" }}>
      <div className={css.ambient} aria-hidden />
      <header className={css.head}>
        <Cover id={album.coverImageId} size={260} radius={18} eager className={css.headCover} />
        <div className={css.headText}>
          <div className={css.eyebrow}>Альбом</div>
          <h1 className={css.headTitle}>{album.title}</h1>
          <div className={css.headSub}>
            {album.albumArtist ? <Link to="/artist/$id" params={{ id: album.albumArtist.id }}>{album.albumArtist.name}</Link> : null}
            {[album.year, `${tracks.length} ${plural(tracks.length, "трек", "трека", "треков")}`, clock(album.durationMs)].filter(Boolean).map((x) => <span key={String(x)}> · {x}</span>)}
          </div>
          <div className={css.actions}>
            <button type="button" className={css.cta} onClick={() => void player.playTracks(items)}><Icon name="Play" size={14} /> Слушать</button>
            <button type="button" className={css.ghost} onClick={shuffle}><Icon name="Shuffle" size={14} /> Вперемешку</button>
            <span className={css.addWrap} data-pop-anchor>
              <button type="button" className={css.ghost} onClick={() => setAdding((v) => !v)} aria-expanded={adding}><Icon name="Plus" size={14} /> В плейлист</button>
              <AddToPlaylist open={adding} trackIds={tracks.map((t) => t.id)} onDone={() => setAdding(false)} />
            </span>
          </div>
        </div>
      </header>
      <TrackList tracks={tracks} context="album" contextId={id} numbered />
    </div>
  );
}
