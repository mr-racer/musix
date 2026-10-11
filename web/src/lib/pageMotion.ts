import type { AnyRouter, ParsedLocation } from "@tanstack/react-router";

/** Page changes (design/code/motion-and-performance.md; the owner, 2026-10-11: «вкладки
 *  открываются без эффектов, а хочется плавно в духе v2»). The router already renders the new
 *  page inside `document.startViewTransition`; here every change gets a kind, written to
 *  `html[data-nav]` for the length of the transition, and styles/pages.css moves the pages by it:
 *  - the island's sections are a column: going down it the new page rises from below, going up
 *    it comes from above, and the island's blob travels between the two;
 *  - the library's tabs are a row: the new tab slides in from its side under the bar, the
 *    underline glides;
 *  - the player grows out of the mini player (its cover flies into the big one) and folds back
 *    into it;
 *  - a page that is not a section (an artist, a playlist, settings) comes forward, and going
 *    back to a section steps back.
 *  The shell (the island, the logo, the gear, the mini player) never moves with the page. */

export type Kind = "down" | "up" | "deeper" | "back" | "tab-next" | "tab-prev" | "player-open" | "player-close";

const SECTIONS = ["/", "/player", "/library", "/search", "/admin"];
const LIB_TABS = ["albums", "artists", "playlists", "stats"];
const tabOf = (l: ParsedLocation) => Math.max(0, LIB_TABS.indexOf(String((l.search as { tab?: unknown }).tab ?? "albums")));

export function kindOf(from: ParsedLocation | undefined, to: ParsedLocation): Kind | null {
  if (!from) return null;
  const a = from.pathname, b = to.pathname;
  if (a === b) {
    // sorts, views and filters change in place: their own motion, not a page change
    if (a !== "/library") return null;
    const ta = tabOf(from), tb = tabOf(to);
    return ta === tb ? null : tb > ta ? "tab-next" : "tab-prev";
  }
  if (b === "/player") return "player-open";
  if (a === "/player") return "player-close";
  const ia = SECTIONS.indexOf(a), ib = SECTIONS.indexOf(b);
  if (ia >= 0 && ib >= 0) return ib > ia ? "down" : "up";
  return ib >= 0 ? "back" : "deeper";
}

/** Where the mini player stood: the player grows out of it and folds back into it. */
function markMini(root: HTMLElement) {
  const r = document.querySelector("[data-mini]")?.getBoundingClientRect();
  if (!r) return;
  root.style.setProperty("--vt-mt", `${Math.round(r.top)}px`);
  root.style.setProperty("--vt-ml", `${Math.round(r.left)}px`);
  root.style.setProperty("--vt-mr", `${Math.round(innerWidth - r.right)}px`);
}

export function installPageMotion(router: AnyRouter): void {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") return;
  let next: Kind | null = null;
  let seq = 0;
  router.subscribe("onBeforeNavigate", (e) => { next = kindOf(e.fromLocation, e.toLocation); });
  // TanStack Router calls `router.startViewTransition(commit)` around every commit (pinned
  // 1.170.x); this takes its place so the kind is known before the old page is photographed
  // and is cleared only when the animation has finished, not when the new page has rendered
  router.startViewTransition = (fn: () => Promise<void>) => {
    const kind = next;
    next = null;
    if (!kind || matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState !== "visible") return fn();
    const root = document.documentElement, my = ++seq;
    if (kind === "player-open") markMini(root);
    root.dataset.nav = kind;
    const t = document.startViewTransition(fn);
    t.ready.catch(() => undefined); // a change interrupted by the next one is skipped, not an error
    void t.finished.finally(() => {
      if (seq !== my) return;
      delete root.dataset.nav;
      if (kind === "player-close") return;
      markMini(root); // the mini player may stand elsewhere next time (a resize)
    });
    return t.updateCallbackDone;
  };
}
