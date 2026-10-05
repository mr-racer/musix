import { useLayoutEffect, useRef, useState } from "react";
import { image, imageUrl } from "../lib/images";
import css from "./Cover.module.css";

/** An album cover at a pixel size. The placeholder is the server palette's colour (no
 *  canvas probe, no blurhash decode on the main thread); `srcset` picks the variant.
 *  `fresh`: for a cover that changes in place (the player's stage). A browser keeps the old
 *  picture in an `<img>` until the new one has loaded, so over a slow link the new track
 *  would wear the previous cover and then snap. With `fresh` every picture is its own
 *  element: the placeholder colour shows at once and the picture fades in when it is there
 *  (not at all if it was already loaded). */
export function Cover({ id, size, radius = 10, alt = "", className, eager, fresh }: {
  id: string | null | undefined;
  size: number;
  radius?: number;
  alt?: string;
  className?: string;
  eager?: boolean;
  fresh?: boolean;
}) {
  const img = image(id);
  const src = imageUrl(id, size * 2);
  const tint = img?.palette?.muted ?? img?.palette?.dominant;
  return (
    <span className={css.cover + (className ? " " + className : "")}
      style={{ ["--size" as string]: `${size}px`, ["--r" as string]: `${radius}px`, ["--tint" as string]: tint ?? "var(--mx-surface-2)" }}>
      {src && (fresh
        ? <Fresh key={src} src={src} alt={alt} size={size} />
        : <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" width={size} height={size} />)}
    </span>
  );
}

function Fresh({ src, alt, size }: { src: string; alt: string; size: number }) {
  const el = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"wait" | "had" | "came">("wait");
  // already in the browser's cache (a preloaded neighbour): there before the first paint, no fade
  useLayoutEffect(() => { if (el.current?.complete && el.current.naturalWidth) setState("had"); }, []);
  return (
    <img ref={el} src={src} alt={alt} width={size} height={size} data-ready={state === "wait" ? undefined : ""}
      className={state === "had" ? undefined : css.fresh} onLoad={() => setState((s) => (s === "wait" ? "came" : s))} />
  );
}
