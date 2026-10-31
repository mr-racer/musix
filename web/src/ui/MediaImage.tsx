import { useState, type ComponentPropsWithRef } from "react";
import { imageFallback } from "../lib/imageFallback";

type Props = Omit<ComponentPropsWithRef<"img">, "src"> & {
  src?: string | null;
  seed?: string | null;
  tint?: string | null;
  fallback?: string;
};

/** A failed request gets the album's quiet palette, never the browser's broken-image icon.
 *  Each source owns its error state: a new URL retries, including a previously failed URL
 *  revisited after another track. No global negative cache or extra layout wrapper. */
export function MediaImage(props: Props) {
  return <SourceImage key={`${props.src ?? ""}\n${props.srcSet ?? ""}`} {...props} />;
}

function SourceImage({ src, srcSet, seed, tint, fallback, onError, ...props }: Props) {
  const [failed, setFailed] = useState(false);
  const missing = !src || failed;
  return <img {...props} src={missing ? fallback ?? imageFallback(seed ?? src, tint) : src}
    srcSet={missing ? undefined : srcSet} data-image-fallback={missing ? "" : undefined}
    onError={(event) => {
      if (missing) return;
      setFailed(true);
      onError?.(event);
    }} />;
}
