/** Real flags (flag-icons 4×3, MIT): emoji flags are two letters on Windows. Each SVG is its
 *  own small asset, fetched only when a country is shown. */
const urls = import.meta.glob("/node_modules/flag-icons/flags/4x3/*.svg", { query: "?url&no-inline", import: "default", eager: true }) as Record<string, string>;
const byCode = new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4).toUpperCase(), url]));

export function flagUrl(cc: string | null | undefined): string | null {
  return (cc && byCode.get(cc.toUpperCase())) || null;
}
