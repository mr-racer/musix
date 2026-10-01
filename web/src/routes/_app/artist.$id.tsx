import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, ok } from "../../api/client";
import { artistQuery } from "../../api/queries";
import { plural } from "../../lib/format";
import { image, imageUrl } from "../../lib/images";
import { fromTrack, player } from "../../player/engine";
import { AlbumCard } from "../../ui/AlbumCard";
import { Icon } from "../../ui/icons";
import { TrackList } from "../../ui/TrackList";
import css from "./detail.module.css";

export const Route = createFileRoute("/_app/artist/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(artistQuery(params.id)),
  component: Artist,
});

const DOSSIER: [string, string][] = [["name_origin", "Откуда название"], ["formed_place", "Откуда"], ["formed_year", "Год основания"], ["grammy_wins", "Грэмми"], ["status", "Статус"], ["active_from", "Активны с"]];

/** v1's artist atlas (golden artist-desktop): the name large at the left, the photo in its
 *  light at the right, then the dossier, the AI bio, the top tracks and the albums. */
function Artist() {
  const { id } = Route.useParams();
  const page = useQuery(artistQuery(id)).data!;
  const bio = useQuery({ queryKey: ["bio", id], queryFn: () => ok(api.GET("/api/v2/artists/{artist_id}/bio", { params: { path: { artist_id: id } } })), retry: false, staleTime: 30 * 60_000 }).data;
  const [open, setOpen] = useState(false);
  const facets = (bio?.facets ?? {}) as Record<string, unknown>;
  const genre = mode(page.topTracks.map((t) => t.genre).filter((g): g is string => !!g));
  const place = typeof facets.formed_place === "string" ? facets.formed_place : null;
  const years = [...page.topTracks, ...page.appearsOn].map((t) => t.year ?? 0).filter((y) => y > 0);
  const dossier = DOSSIER.map(([k, label]) => [label, facets[k]] as const).filter((r): r is readonly [string, string | number] => typeof r[1] === "string" || typeof r[1] === "number");
  const photo = imageUrl(page.artist.imageId, 900);
  const tint = image(page.artist.imageId)?.palette?.vibrant ?? "#d4a55a";
  const play = () => void player.playTracks([...page.topTracks, ...page.appearsOn].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i).map((t) => fromTrack(t, "artist", id)));

  return (
    <div className={css.page} style={{ ["--tint" as string]: tint }}>
      <div className={css.atlasGlow} aria-hidden />
      <nav className={css.crumbs} aria-label="Путь"><Link to="/library" search={{ tab: "artists" }}>Библиотека</Link> / <span>Артисты</span> / <b>{page.artist.name}</b></nav>
      <header className={css.atlas}>
        <div className={css.atlasText}>
          <h1 className={css.atlasName}>{page.artist.name}</h1>
          {(genre || place) && <div className={css.atlasTags}>{[genre, place].filter(Boolean).join(" · ")}</div>}
          {years.length > 0 && <div className={css.atlasMeta}>Десятилетия в твоей библиотеке · {Math.floor(Math.min(...years) / 10) * 10}s–{Math.floor(Math.max(...years) / 10) * 10}s</div>}
          <div className={css.atlasMeta}>{page.albums.length} {plural(page.albums.length, "альбом", "альбома", "альбомов")} · {page.trackCount} {plural(page.trackCount, "трек", "трека", "треков")}</div>
          <button type="button" className={css.playPill} onClick={play}><span className={css.playKey}><Icon name="Play" size={14} /></span> Включить артиста</button>
        </div>
        {photo && <div className={css.portrait}><img src={photo} alt={page.artist.name} /></div>}
      </header>
      <div className={css.atlasBody}>
        {dossier.length > 0 && (
          <aside className={css.dossier}>
            <div className={css.dossierTitle}>Досье</div>
            {dossier.map(([k, v]) => (
              <div key={k} className={css.dossierRow}><span className={css.dossierKey}>{k}</span><span>{String(v)}</span></div>
            ))}
          </aside>
        )}
        <div className={css.atlasMain}>
          {bio?.text && (
            <section className={css.bio}>
              <div className={css.eyebrow}>Биография <span className={css.ai}>AI</span></div>
              <p className={open ? css.bioOpen : css.bioText}>{bio.text}</p>
              {!open && <button type="button" className={css.more} onClick={() => setOpen(true)}>читать дальше ↓</button>}
            </section>
          )}
          {page.topTracks.length > 0 && (
            <section className={css.block}>
              <div className={css.eyebrow}>Треки</div>
              <TrackList tracks={page.topTracks.slice(0, 10)} context="artist" contextId={id} />
            </section>
          )}
          {page.albums.length > 0 && (
            <section className={css.block}>
              <div className={css.eyebrow}>Альбомы</div>
              <div className={css.albums}>
                {page.albums.map((a) => (
                  <AlbumCard key={a.id} id={a.id} coverImageId={a.coverImageId} title={a.title} size={180}
                    sub={[a.year, `${a.trackCount} тр`].filter(Boolean).join(" · ")} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function mode(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
