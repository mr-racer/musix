import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { image } from "../lib/images";
import css from "./AlbumCard.module.css";
import { Cover } from "./Cover";
import { openAlbum } from "./Gatefold";

/** v1's album card (AtlasAlbumCard). On hover, the record slides out from behind the
 *  tilted sleeve. A click opens the gatefold from this cover; a modified click follows
 *  the `/album/$id` link. */
export function AlbumCard({ id, coverImageId, title, sub, badge, size = 200 }: {
  id: string;
  coverImageId: string | null | undefined;
  title: string;
  sub?: string;
  badge?: string;
  size?: number;
}) {
  const deck = useRef<HTMLSpanElement>(null);
  const pal = image(coverImageId)?.palette;
  const label = `radial-gradient(circle at 38% 32%, ${pal?.vibrant ?? "oklch(62% 0.16 285)"}, ${pal?.accent.dark ?? "oklch(45% 0.16 300)"} 70%)`;
  return (
    <Link to="/album/$id" params={{ id }} className={css.card} onClick={(e) => openAlbum(e, id, coverImageId ?? null, deck.current)}>
      <span ref={deck} className={css.deck}>
        <span className={css.disc} aria-hidden><span className={css.grooves}><span className={css.label} style={{ background: label }} /></span></span>
        <span className={css.sleeve}>
          <Cover id={coverImageId} size={size} radius={12} />
          <span className={css.sheen} aria-hidden />
          {badge && <span className={css.badge}>{badge}</span>}
        </span>
      </span>
      <span className={css.title}>{title}</span>
      {sub && <span className={css.sub}>{sub}</span>}
    </Link>
  );
}
