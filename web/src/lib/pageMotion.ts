import type { AnyRouter, ParsedLocation } from "@tanstack/react-router";
import { flushSync } from "react-dom";

/** Page changes (design/code/motion-and-performance.md; the owner, 2026-10-11: «вкладки
 *  открываются без эффектов, а хочется плавно в духе v2»). The router already renders the new
 *  page inside `document.startViewTransition`; here every change gets a kind, written to
 *  `html[data-nav]` for the length of the transition, and styles/pages.css moves the pages by it:
 *  - the island's sections are a column: going down it the new page rises from below, going up
 *    it comes from above, and the island's blob travels between the two;
 *  - the library's tabs are a row: the new tab slides in from its side under the bar, the
 *    underline glides; a new grouping or filter of the wall settles in place under the bar;
 *  - the player comes into focus over the page, which blurs and dims behind it, while the cover,
 *    the title, the artist and the seek line fly from the mini player to their places; closing
 *    is the same road back (the owner, round 2: no sheet, no rectangle sliding over the screen);
 *  - a page that is not a section (an artist, a playlist, settings) comes forward, and going
 *    back to a section steps back.
 *  The shell (the island, the logo, the gear, the mini player) never moves with the page. */

export type Kind = "down" | "up" | "deeper" | "back" | "tab-next" | "tab-prev" | "regroup" | "player-open" | "player-close";

const SECTIONS = ["/", "/player", "/library", "/assistant", "/admin"];
const LIB_TABS = ["albums", "artists", "playlists", "stats"];
const tabOf = (l: ParsedLocation) => Math.max(0, LIB_TABS.indexOf(String((l.search as { tab?: unknown }).tab ?? "albums")));
const q = (l: ParsedLocation, k: string) => String((l.search as Record<string, unknown>)[k] ?? "");

export function kindOf(from: ParsedLocation | undefined, to: ParsedLocation): Kind | null {
  if (!from) return null;
  const a = from.pathname, b = to.pathname;
  if (a === b) {
    if (a !== "/library") return null;
    const ta = tabOf(from), tb = tabOf(to);
    if (ta !== tb) return tb > ta ? "tab-next" : "tab-prev";
    // another grouping or view of the same wall (the owner: «смена группировок … рвано выглядит»)
    return q(from, "sort") !== q(to, "sort") || q(from, "view") !== q(to, "view") ? "regroup" : null;
  }
  if (b === "/player") return "player-open";
  if (a === "/player") return "player-close";
  const ia = SECTIONS.indexOf(a), ib = SECTIONS.indexOf(b);
  if (ia >= 0 && ib >= 0) return ib > ia ? "down" : "up";
  return ib >= 0 ? "back" : "deeper";
}

let seq = 0;
const able = () => typeof document !== "undefined" && typeof document.startViewTransition === "function"
  && !matchMedia("(prefers-reduced-motion: reduce)").matches && document.visibilityState === "visible";

/** Runs `update` (DOM work that must be done when it returns) as a change of this kind. */
function run(kind: Kind, update: () => Promise<void> | void): Promise<void> {
  const root = document.documentElement, my = ++seq;
  root.dataset.nav = kind;
  const t = document.startViewTransition(update);
  t.ready.catch(() => undefined); // a change interrupted by the next one is skipped, not an error
  void t.finished.finally(() => { if (seq === my) delete root.dataset.nav; });
  return t.updateCallbackDone;
}

/** A change of state that is not a route (a filter of the wall) moving like a page change. */
export function morph(kind: Kind, update: () => void): void {
  if (!able()) return update();
  void run(kind, () => flushSync(update));
}

export function installPageMotion(router: AnyRouter): void {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") return;
  let next: Kind | null = null;
  router.subscribe("onBeforeNavigate", (e) => { next = kindOf(e.fromLocation, e.toLocation); });
  // TanStack Router calls `router.startViewTransition(commit)` around every commit (pinned
  // 1.170.x); this takes its place so the kind is known before the old page is photographed
  // and is cleared only when the animation has finished, not when the new page has rendered
  router.startViewTransition = (fn: () => Promise<void>) => {
    const kind = next;
    next = null;
    return kind && able() ? run(kind, fn) : fn();
  };
}
