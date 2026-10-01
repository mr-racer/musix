/** v1's «dusty» bands: the hue of a cover colour with saturation and lightness held, so a
 *  grey cover still gives a readable aurora and orb (hsl(h, 36–60 %, L)). */
export function dusty(hex: string, lightness = 58): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60 + 360) % 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return `hsl(${h} ${Math.round(Math.min(0.6, Math.max(0.36, s)) * 100)}% ${lightness}%)`;
}

export const BRAND_BLOBS = ["#7C5BFF", "#FF78C8", "#E0B341", "#B06BFF"];
