import css from "./Brand.module.css";

const BARS = [
  { h: 0.44, c: "oklch(64% 0.19 268)" },
  { h: 0.7, c: "oklch(69% 0.17 278)" },
  { h: 0.94, c: "oklch(74% 0.14 292)" },
  { h: 0.6, c: "oklch(72% 0.09 350)" },
  { h: 0.36, c: "oklch(76% 0.13 80)" },
];

/** v1 `BrandMark`: a dark tile with five EQ bars in the brand colours. */
export function BrandMark({ size = 34 }: { size?: number }) {
  const w = 3.1, gap = 1.3;
  const x0 = (24 - (BARS.length * w + (BARS.length - 1) * gap)) / 2;
  return (
    <span className={css.mark} style={{ ["--s" as string]: `${size}px` }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" aria-hidden>
        {BARS.map((b, i) => (
          <rect key={i} x={x0 + i * (w + gap)} y={12 - (b.h * 19) / 2} width={w} height={b.h * 19} rx={w / 2} fill={b.c} />
        ))}
      </svg>
    </span>
  );
}

export function Wordmark() {
  return (
    <span className={css.word}>
      Musi<em>X</em>
    </span>
  );
}
