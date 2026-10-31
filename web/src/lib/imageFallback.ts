import { coverHues } from "./coverFill";

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** The existing cover palette and record mark, also usable by imperative image layers.
 *  It remains an image so flights, masks and measured cover boxes keep their geometry. */
export function imageFallback(seed?: string | null, tint?: string | null): string {
  const [hue, hue2] = coverHues(seed);
  const top = xml(tint || `oklch(44% 0.075 ${hue})`), bottom = `oklch(25% 0.06 ${hue2})`;
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="b" x2=".5" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><radialGradient id="l" cx=".22" cy=".12" r=".9"><stop stop-color="oklch(70% 0.07 ${hue})" stop-opacity=".5"/><stop offset="1" stop-opacity="0"/></radialGradient></defs><path fill="url(#b)" d="M0 0h256v256H0z"/><path fill="url(#l)" d="M0 0h256v256H0z"/><g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"><circle cx="128" cy="128" r="39"/><circle cx="128" cy="128" r="9"/></g></svg>`);
}

/** Decorative reflections disappear when unavailable; they never become replacement art. */
export const transparentImage = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
