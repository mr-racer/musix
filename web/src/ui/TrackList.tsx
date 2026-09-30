import type { ReactNode } from "react";
import type { Schemas } from "../api/client";
import { clock } from "../lib/format";
import type { ContextType } from "../player/listen";
import { fromTrack, player, usePlayer } from "../player/engine";
import { Cover } from "./Cover";
import { Icon } from "./icons";
import css from "./TrackList.module.css";

/** Tracks as rows in the player queue's style: a click plays the list from that row. */
export function TrackList({ tracks, context = "search", contextId, numbered, trailing }: {
  tracks: Schemas["TrackOut"][];
  context?: ContextType;
  contextId?: string;
  numbered?: boolean;
  trailing?: (t: Schemas["TrackOut"], i: number) => ReactNode;
}) {
  const current = usePlayer((s) => s.queue[s.index]?.trackId);
  const items = tracks.map((t) => fromTrack(t, context, contextId));
  return (
    <ol className={css.tracks}>
      {tracks.map((t, i) => (
        <li key={t.id + ":" + i} className={t.id === current ? css.rowOn : css.row}>
          <button type="button" className={css.track} onClick={() => void player.playTracks(items, i)}>
            {numbered ? <span className={css.num}>{t.id === current ? <Icon name="Bars" size={14} /> : (t.trackNo ?? i + 1)}</span> : <Cover id={t.coverImageId} size={40} radius={6} />}
            <span className={css.text}>
              <span className={css.title}>{t.titleDisplay ?? t.title}</span>
              <span className={css.sub}>{numbered ? t.artistDisplay : [t.artistDisplay, t.album].filter(Boolean).join(" · ")}</span>
            </span>
            <span className={css.time}>{t.durationMs ? clock(t.durationMs) : ""}</span>
          </button>
          {trailing?.(t, i)}
        </li>
      ))}
    </ol>
  );
}
