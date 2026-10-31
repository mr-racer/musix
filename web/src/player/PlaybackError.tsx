import { player, usePlayer } from "./engine";
import css from "./PlaybackError.module.css";

/** Persistent recovery lives with the player, so changing screens cannot hide a failure. */
export function PlaybackError() {
  const error = usePlayer((s) => s.error);
  if (!error) return null;
  return (
    <div className={css.error} role="alert">
      <span>{error}</span>
      <button type="button" onClick={() => void player.retry()}>Повторить</button>
    </div>
  );
}
