import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Cover } from "../ui/Cover";
import { Icon } from "../ui/icons";
import { player, usePlayer } from "./engine";
import css from "./MiniPlayer.module.css";

/** The bar under every screen but the player: cover + title (opens the player), transport,
 *  and a hairline of progress. It sets `--player-h` so the page leaves room for it. */
export function MiniPlayer() {
  const item = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const progress = usePlayer((s) => (s.durationMs ? s.positionMs / s.durationMs : 0));
  const onPlayer = useRouterState({ select: (s) => s.location.pathname === "/player" });
  const shown = !!item && !onPlayer;

  useEffect(() => {
    document.documentElement.style.setProperty("--player-h", shown ? "68px" : "0px");
  }, [shown]);

  if (!shown) return null;
  return (
    <div className={css.bar} role="region" aria-label="Сейчас играет">
      <div className={css.line} style={{ ["--p" as string]: String(progress) }} />
      <Link to="/player" className={css.now}>
        <Cover id={item.coverImageId} size={44} radius={8} />
        <span className={css.text}>
          <span className={css.title}>{item.title}</span>
          <span className={css.artist}>{item.artist}</span>
        </span>
      </Link>
      <div className={css.controls}>
        <button type="button" className={css.btn} onClick={() => void player.prev()} aria-label="Предыдущий"><Icon name="Prev" size={18} /></button>
        <button type="button" className={css.play} onClick={() => player.toggle()} aria-label={playing ? "Пауза" : "Играть"} aria-busy={buffering}>
          <Icon name={playing ? "Pause" : "Play"} size={20} />
        </button>
        <button type="button" className={css.btn} onClick={() => void player.next()} aria-label="Следующий"><Icon name="Next" size={18} /></button>
      </div>
    </div>
  );
}
