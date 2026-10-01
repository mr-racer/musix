import { useCallback, useState } from "react";
import css from "./ArtistFigure.module.css";

/** v1's atlas cutout hero (main.jsx Atlas, mode `cutout`):
 *  - the artist's transparent PNG stands in a burst of slowly turning light rays, with a
 *    pulsing flare and drifting sparks behind;
 *  - a blurred, brightened echo of the same PNG glows behind the figure;
 *  - a pool of light with a glass rim makes the floor under the feet.
 *  Every layer rides the cursor parallax (`--hx/--hy`, set by the page's hero). */
export function ArtistFigure({ src, hue }: { src: string; hue: number }) {
  const [ped, setPed] = useState<{ w: number } | null>(null);
  // the pedestal is as wide as the figure is DRAWN (object-fit: contain), not as its box
  const measure = useCallback((img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const box = img.getBoundingClientRect();
    setPed({ w: Math.min(box.width, (box.height * img.naturalWidth) / img.naturalHeight) });
  }, []);
  return (
    <div className={css.figure} style={{ ["--hue" as string]: hue }} aria-hidden>
      <img src={src} alt="" className={css.echo} />
      {ped && <div className={css.pedestal} style={{ width: Math.max(160, ped.w * 1.05) }}><i /><i /><i /></div>}
      <img src={src} alt="" className={css.cutout} onLoad={(e) => measure(e.currentTarget)} />
    </div>
  );
}

/** The light field behind the hero: the rays, the flare and the sparks, centred on the figure. */
export function Burst({ hue }: { hue: number }) {
  return (
    <div className={css.field} style={{ ["--hue" as string]: hue }} aria-hidden>
      <div className={css.base} />
      <div className={css.burstBox}><div className={css.burst}><div className={css.sparks} /></div></div>
      <div className={css.grain} />
    </div>
  );
}

/** A flag from an ISO 3166-1 alpha-2 code (regional indicator letters). */
export function flag(cc: string | null | undefined): string {
  return cc && /^[a-z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}
