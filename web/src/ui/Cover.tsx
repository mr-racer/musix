import { image, imageUrl } from "../lib/images";
import css from "./Cover.module.css";

/** An album cover at a pixel size. The placeholder is the server palette's colour (no
 *  canvas probe, no blurhash decode on the main thread); `srcset` picks the variant. */
export function Cover({ id, size, radius = 10, alt = "", className, eager }: {
  id: string | null | undefined;
  size: number;
  radius?: number;
  alt?: string;
  className?: string;
  eager?: boolean;
}) {
  const img = image(id);
  const src = imageUrl(id, size * 2);
  const tint = img?.palette?.muted ?? img?.palette?.dominant;
  return (
    <span className={css.cover + (className ? " " + className : "")}
      style={{ ["--size" as string]: `${size}px`, ["--r" as string]: `${radius}px`, ["--tint" as string]: tint ?? "var(--mx-surface-2)" }}>
      {src && <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" width={size} height={size} />}
    </span>
  );
}
