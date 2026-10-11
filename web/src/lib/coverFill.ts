/** The cover of an album that has none (the owner, 2026-10-11: «альбомы без обложек выглядят
 *  чёрными, а при раскрытии — с рандомным цветом»): a soft two-tone gradient with a gentle light
 *  in its top corner, its hue fixed by the album, so the same album wears the same colour on
 *  the wall, in the gatefold, in the mini player and in the player (and while the cover flies
 *  between them). Low chroma: a quiet surface, never a loud swatch. */
export function coverFill(seed: string | null | undefined): string {
  let h = 2166136261;
  for (let i = 0; i < (seed ?? "").length; i++) { h ^= seed!.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hue = (h >>> 0) % 360, hue2 = (hue + 34) % 360;
  return `radial-gradient(120% 95% at 22% 12%, oklch(70% 0.07 ${hue} / 0.5), transparent 62%), linear-gradient(150deg, oklch(44% 0.075 ${hue}), oklch(25% 0.06 ${hue2}))`;
}
