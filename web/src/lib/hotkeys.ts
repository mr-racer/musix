import { player, usePlayer } from "../player/engine";

/** The keys the settings list (design/reference/settings): Space plays and pauses, ← → seek by
 *  10 s, Shift ← → go to the previous and the next song, / searches, L gives the song a fire,
 *  Q opens the queue. Never while typing, never with Ctrl/Alt/Meta (the browser's own). */
export function installHotkeys(go: { search: () => void; queue: () => void; libraryHasSearch: () => boolean }): () => void {
  const on = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable], [role='slider']")) return;
    const s = usePlayer.getState(), have = s.index >= 0 && !!s.queue[s.index];
    switch (e.key) {
      case " ":
        if (t?.closest("button, a, [role='button']") || !have) return;
        e.preventDefault();
        player.toggle();
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        if (!have || t?.closest("[role='tablist'], [role='group'], [role='menu']")) return;
        e.preventDefault();
        const fwd = e.key === "ArrowRight";
        if (e.shiftKey) return void (fwd ? player.next() : player.prev());
        const at = s.positionMs + (fwd ? 10_000 : -10_000);
        player.seek(Math.max(0, s.durationMs ? Math.min(s.durationMs - 500, at) : at));
        return;
      }
      case "/":
        if (go.libraryHasSearch()) return; // the library's own search takes it
        e.preventDefault();
        go.search();
        return;
      case "l":
      case "L":
      case "д":
      case "Д":
        if (!have || s.taste?.locked) return;
        void player.react("fire");
        return;
      case "q":
      case "Q":
      case "й":
      case "Й":
        if (!have) return;
        go.queue();
        return;
    }
  };
  window.addEventListener("keydown", on);
  return () => window.removeEventListener("keydown", on);
}
