import { useEffect, useState } from "react";

/** False on a screen's first render, true a frame later. A page change photographs the new
 *  screen's first render and holds the old picture still until it is done (lib/pageMotion.ts),
 *  so what the change does not show — a closed window, a list behind a button — mounts after
 *  that picture is taken, and the change starts sooner. The frame comes only once the picture
 *  is taken: the browser runs no frames while a page change renders its new page. */
export function useAfterPaint(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}
