import type { Schemas } from "../api/client";
import { image } from "../lib/images";
import { plural } from "../lib/format";

/** The artist page's data, shaped once per response (design/reference/artist/logic.js `prep`). */
export type Page = Schemas["ArtistPageOut"];
export type Bio = Schemas["BioOut"] | null;
export type Album = { id: string; title: string; clean: string; ed: string | null; year: number | null; n: number; heard: number; cover: string | null };
export type Shot = { id: string; kind: "wide" | "sq" } | null;

const GENRE: Record<string, string> = { "Hip-Hop": "Хип-хоп", "Hip Hop": "Хип-хоп", Rap: "Рэп", Pop: "Поп", Rock: "Рок", "R&B": "R&B", Electronic: "Электроника", Dance: "Танцевальная", Alternative: "Альтернатива", Indie: "Инди", Metal: "Метал", Jazz: "Джаз", Soul: "Соул", Country: "Кантри", Classical: "Классика", Soundtrack: "Саундтрек", Reggae: "Регги", Punk: "Панк", Folk: "Фолк", Blues: "Блюз", Funk: "Фанк" };
// short Russian names where Intl's are long («Соединенные Штаты», «Соединенное Королевство»)
const COUNTRY: Record<string, string> = { US: "США", GB: "Великобритания", AE: "ОАЭ", KR: "Южная Корея", KP: "КНДР", CZ: "Чехия", RU: "Россия", NL: "Нидерланды" };
// what tags add to a reissue's title: shown as a chip next to the clean title
const EDITION = /\s*[(\[]([^)\]]*(?:Edition|Deluxe|Version|Remaster|Tour|Anniversary|Expanded)[^)\]]*)[)\]]\s*$/i;

export function countryName(cc: string | null | undefined): string | null {
  if (!cc) return null;
  const up = cc.toUpperCase();
  if (COUNTRY[up]) return COUNTRY[up];
  try { return new Intl.DisplayNames(["ru"], { type: "region" }).of(up) ?? null; } catch { return null; }
}

function mode(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d{4}$/.test(v) ? +v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Luminance of #rrggbb, 0..1 (a light editorial page colour tames the photo). */
export function lum(hex: string | null | undefined): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export function prep(page: Page, bio: Bio) {
  const f = (bio?.facets ?? {}) as Record<string, unknown>;
  const all = page.albums.map((a): Album => {
    const m = EDITION.exec(a.title) ?? /\s*,?\s*-\s*(EP)$/.exec(a.title);
    return {
      id: a.id, title: a.title, cover: a.coverImageId ?? null, n: a.trackCount, heard: page.heard?.[a.id] ?? 0,
      year: a.originalYear ?? a.year ?? null,
      clean: m ? a.title.slice(0, m.index).replace(/,\s*$/, "") : a.title,
      ed: m ? m[1]!.replace(/Australian Tour Edition/i, "Tour Edition").replace(/Expanded Edition/i, "Expanded") : null,
    };
  }).sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999) || x.clean.localeCompare(y.clean));
  // singles and two-song leftovers stay off the timeline when the artist has real albums
  const full = all.filter((a) => a.n >= 3);
  const albums = full.length ? full : all;
  const first = albums.find((a) => a.year)?.year ?? null;
  const status = str(f.status)?.toLowerCase() ?? "";
  const dead = /deceased|died|умер|скончал/.test(status), ended = dead || /disband|split|распал|inactive/.test(status);
  // the start: the founding year; «active from» only when it is not later than the first album
  // (bios carry Eminem's as 2003, four years after The Slim Shady LP)
  const af = num(f.active_from);
  const formed = num(f.formed_year) ?? (af && (!first || af <= first) ? af : null);
  const shot: Shot = page.wideId ? { id: page.wideId, kind: "wide" } : page.photoId ? { id: page.photoId, kind: "sq" } : page.artist.imageId ? { id: page.artist.imageId, kind: "sq" } : null;
  const tint = image(shot?.id ?? page.artist.imageId)?.palette?.vibrant ?? "#d4a55a";
  const genre = mode(page.topTracks.map((t) => t.genre).filter((g): g is string => !!g));
  const text = (bio?.text ?? "").trim();
  return {
    name: page.artist.name,
    shot, tint, light: lum(page.pageColor) > 0.55,
    logo: page.logoId ?? null,
    cc: page.countryCode ?? null,
    country: countryName(page.countryCode) ?? page.country ?? null,
    city: str(f.formed_place),
    genre: genre ? GENRE[genre] ?? genre : null,
    start: formed && first ? Math.min(formed, first) : formed ?? first, formedYear: formed, end: ended ? num(f.active_to) : null, dead,
    nameOrigin: str(f.name_origin),
    bio: text,
    albums,
    tracks: page.trackCount,
    grammy: page.grammy ?? null,
    facts: (page.facts ?? []).map((x) => x.text).filter(Boolean),
    you: page.you ?? { plays: 0, heardTracks: 0, rank: null, artists: 0 },
  };
}
export type Model = ReturnType<typeof prep>;

/** Paragraphs of ~380 characters, cut at sentence ends (the window reads like a page). */
export function paragraphs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of text.split(/(?<=[.!?»])\s+(?=[A-ZА-ЯЁ«])/)) {
    cur += (cur ? " " : "") + s;
    if (cur.length > 380) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

// ── levels: a fan's way to the stage, the metal by rank (slate, bronze, silver, gold, platinum) ──
export const LEVELS = [
  { n: "На разогреве", at: 0, m: "#9aa3b5", bg: "linear-gradient(145deg,#e4e8f0,#8e97a8)", tx: "linear-gradient(180deg,#eef1f6,#9aa3b5)" },
  { n: "Танцпол", at: 10, m: "#c98a5a", bg: "linear-gradient(145deg,#f6d3b0,#b9784a 55%,#7a4524)", tx: "linear-gradient(180deg,#f8dcc0,#c98a5a)" },
  { n: "Первый ряд", at: 50, m: "#c8ccd6", bg: "linear-gradient(145deg,#ffffff,#c9cdd7 50%,#8a8f9c)", tx: "linear-gradient(180deg,#ffffff,#b4b9c5)" },
  { n: "Бэкстейдж", at: 150, m: "#e3bd63", bg: "linear-gradient(145deg,#fff1c4,#e3bd63 50%,#a87a26)", tx: "linear-gradient(180deg,#fff3cf,#d9ae4c)" },
  { n: "Легенда", at: 300, m: "#cdd6ff", bg: "linear-gradient(145deg,#ffffff,#dfe6f5 35%,#c6cfee 55%,#f0e2f6 75%,#b9c1d6)", tx: "linear-gradient(100deg,#f6f8ff,#c9d5ff 40%,#f3daf6 70%,#dfe8ff)" },
] as const;

/** Plays open the first three levels; «Бэкстейдж» also wants half of the albums heard through
 *  (half of an album's songs or more), «Легенда» every album. */
export function level(plays: number, albums: Album[]) {
  const done = albums.filter((a) => a.n && a.heard / a.n >= 0.5).length, cov = done / Math.max(1, albums.length);
  let k = 0;
  for (let j = 0; j < LEVELS.length; j++) if (plays >= LEVELS[j]!.at && (j < 3 || cov >= (j === 3 ? 0.5 : 1))) k = j;
  const nx = LEVELS[k + 1];
  let need: { to: string; rest: string } | null = null, p = 1;
  if (nx) {
    const covNeed = k + 1 === 3 ? 0.5 : k + 1 === 4 ? 1 : 0;
    if (plays < nx.at) { const l = nx.at - plays; need = { to: nx.n, rest: `${l} ${plural(l, "прослушивание", "прослушивания", "прослушиваний")}` }; p = plays / nx.at; }
    else { const l = Math.ceil(covNeed * albums.length) - done; need = { to: nx.n, rest: `${l} ${plural(l, "альбом", "альбома", "альбомов")} дослушать` }; p = cov / covNeed; }
  }
  return { ...LEVELS[k]!, k, need, p: Math.min(1, Math.max(0, p)), done };
}

/** How often the artist is on the listener's air, against the library's other artists: radio
 *  words, not a place in the top (the owner, 2026-10-16), with a five-bar meter. */
const FREQ: [string, number][] = [["Не сходит с эфира", 5], ["Тяжёлая ротация", 4], ["В ротации", 3], ["Частый гость эфира", 2], ["Иногда в эфире", 1], ["Редко в эфире", 1]];
export function freq(you: Model["you"]) {
  const N = you.artists, r = you.rank;
  if (!r || !you.plays || N < 1) return { n: "Ещё не в эфире", bars: 0, s: "ни одного прослушивания" };
  const q = r / N, t = r === 1 ? 0 : q <= 0.02 ? 1 : q <= 0.1 ? 2 : q <= 0.3 ? 3 : q <= 0.6 ? 4 : 5;
  const pct = N > 1 ? Math.floor(((N - r) / (N - 1)) * 100) : 100;
  return { n: FREQ[t]![0], bars: FREQ[t]![1], s: r === 1 ? "чаще всех в твоей библиотеке" : `чаще, чем ${pct} % твоих артистов` };
}

// ── the Grammy laurel: its branches grow with the wins (a full wreath from 12) ──
export function laurelPath(k: number): string {
  const P0 = [11.6, 28.5], P1 = [0.4, 19], P2 = [7.6, 1.6];
  const at = (t: number) => [0, 1].map((j) => (1 - t) ** 2 * P0[j]! + 2 * (1 - t) * t * P1[j]! + t * t * P2[j]!) as [number, number];
  const tan = (t: number) => { const v = [0, 1].map((j) => 2 * (1 - t) * (P1[j]! - P0[j]!) + 2 * t * (P2[j]! - P1[j]!)), l = Math.hypot(v[0]!, v[1]!); return [v[0]! / l, v[1]! / l] as [number, number]; };
  const rot = (d: [number, number], a: number): [number, number] => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
  const f = (x: number) => x.toFixed(2);
  const leaf = (p: [number, number], d: [number, number], L: number, w: number) => {
    const q = [p[0] + d[0] * L, p[1] + d[1] * L], m = [p[0] + d[0] * L * 0.5, p[1] + d[1] * L * 0.5], n = [-d[1] * w, d[0] * w];
    return `M${f(p[0])} ${f(p[1])}Q${f(m[0]! + n[0]!)} ${f(m[1]! + n[1]!)} ${f(q[0]!)} ${f(q[1]!)}Q${f(m[0]! - n[0]!)} ${f(m[1]! - n[1]!)} ${f(p[0])} ${f(p[1])}Z`;
  };
  let d = "";
  for (let i = 0; i < k; i++) {
    const t = k === 1 ? 0.1 : 0.1 + (i * 0.8) / (k - 1), p = at(t), tg = tan(t), L = 5.4 - (i * 1.2) / Math.max(1, k - 1);
    d += leaf(p, rot(tg, -0.62), L, 1.55) + leaf(p, rot(tg, 0.55), L * 0.78, 1.3);
  }
  return d + leaf(at(0.97), tan(0.97), 4, 1.4);
}
export const LAUREL_STEM = "M11.6 28.5Q0.4 19 7.6 1.6";
export const laurelLeaves = (wins: number) => (wins ? Math.min(6, 1 + Math.ceil(wins / 2.4)) : 2);

export const pl = { songs: (n: number) => plural(n, "песня", "песни", "песен"), songsOf: (n: number) => plural(n, "песни", "песен", "песен"), albums: (n: number) => plural(n, "альбом", "альбома", "альбомов"), plays: (n: number) => plural(n, "прослушивание", "прослушивания", "прослушиваний") };
