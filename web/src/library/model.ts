import type { AlbumRow, ArtistRow, TrackRow } from "../api/db";
import type { Schemas } from "../api/client";
import { sortKey } from "../api/sync";
import { plural } from "../lib/format";

/** The library's data and its groups (design/code/screens/library.md). Everything comes from
 *  the device's mirror; the server's summary adds plays, last listens, sound clusters,
 *  countries and «Пластинка дня». */

export type Summary = Schemas["LibrarySummaryOut"];

export interface AlbumCard {
  id: string;
  title: string;
  key: string;
  year: number | null;
  artist: string;
  artistId: string | null;
  cover: string | null;
  n: number;
  ms: number;
  added: number;
  plays: number;
  last: string | null;
  genre: string;
  cluster: number | null;
}

export interface ArtistCard {
  id: string;
  name: string;
  key: string;
  image: string | null;
  cover: string | null; // a cover of theirs, for the search and a missing photo
  n: number;
  albums: number;
  plays: number;
  cc: string | null;
}

const GENRE: Record<string, string> = {
  rock: "Рок", pop: "Поп", "hip-hop": "Хип-хоп", "hip hop": "Хип-хоп", "r&b/soul": "R&B и соул", electronic: "Электроника",
  alternative: "Альтернатива", soundtrack: "Саундтреки", "nu-metal": "Ню-метал",
};
export const genreRu = (g: string | null | undefined) => GENRE[(g ?? "").trim().toLowerCase()] ?? "Другое";

export function albumCards(albums: AlbumRow[], tracks: TrackRow[], artists: Map<string, ArtistRow>, sum: Summary | undefined): AlbumCard[] {
  const by = new Map<string, TrackRow[]>();
  for (const t of tracks) if (t.albumId) (by.get(t.albumId) ?? by.set(t.albumId, []).get(t.albumId)!).push(t);
  const out: AlbumCard[] = [];
  for (const a of albums) {
    const ts = by.get(a.id);
    if (!ts?.length) continue;
    const g = new Map<string, number>();
    for (const t of ts) { const k = genreRu(t.genre); g.set(k, (g.get(k) ?? 0) + 1); }
    const genre = [...g.entries()].sort((x, y) => y[1] - x[1] || (x[0] === "Другое" ? 1 : -1))[0]![0];
    const artist = (a.albumArtistId && artists.get(a.albumArtistId)?.name) || ts[0]!.artist;
    out.push({
      id: a.id, title: a.title, key: sortKey(a.title), year: a.year ?? ts[0]!.year, artist, artistId: a.albumArtistId ?? ts[0]!.artistIds[0] ?? null,
      cover: a.coverImageId ?? ts[0]!.coverImageId, n: ts.length, ms: ts.reduce((s, t) => s + t.durationMs, 0),
      added: Math.min(...ts.map((t) => t.addedAt)), plays: sum?.albumPlays?.[a.id] ?? 0, last: sum?.albumLast?.[a.id] ?? null,
      genre, cluster: sum?.albumCluster?.[a.id] ?? null,
    });
  }
  return out;
}

export function artistCards(artists: ArtistRow[], tracks: TrackRow[], albums: AlbumRow[], sum: Summary | undefined): ArtistCard[] {
  const n = new Map<string, number>(), cover = new Map<string, string | null>(), own = new Map<string, number>();
  for (const t of tracks) for (const id of t.artistIds) { n.set(id, (n.get(id) ?? 0) + 1); if (!cover.get(id)) cover.set(id, t.coverImageId); }
  const live = new Set(tracks.map((t) => t.albumId));
  for (const a of albums) if (a.albumArtistId && live.has(a.id)) own.set(a.albumArtistId, (own.get(a.albumArtistId) ?? 0) + 1);
  return artists
    .filter((a) => (n.get(a.id) ?? 0) >= 3 || own.has(a.id))
    .map((a) => ({
      id: a.id, name: a.name, key: a.sortName, image: a.imageId, cover: cover.get(a.id) ?? null, n: n.get(a.id) ?? 0,
      albums: own.get(a.id) ?? 0, plays: sum?.artistPlays?.[a.id] ?? 0, cc: sum?.artistCountry?.[a.id] ?? null,
    }));
}

// ── groups: every sort splits the wall ──────────────────────────────────────

export interface Section<T> { key: string; name: string; short: string; sub: string; items: T[]; cc?: string }
export type AlbumSort = "plays" | "new" | "az" | "year" | "genre";
export type ArtistSort = "plays" | "az" | "country" | "tracks";
export type Lens = "tags" | "sound";

const MONTH = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MSHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const nAlb = (n: number) => `${n} ${plural(n, "альбом", "альбома", "альбомов")}`;
export const nArt = (n: number) => `${n} ${plural(n, "артист", "артиста", "артистов")}`;
export const nSong = (n: number) => `${n} ${plural(n, "песня", "песни", "песен")}`;
const BANDS_AL = ["Заслушаны до дыр", "Часто", "Иногда", "Изредка", "Пару раз", "Ни разу"];
const BANDS_AR = ["Слушаю постоянно", "Часто", "Иногда", "Изредка", "Пару раз", "Ни разу"];

/** Listening bands by quintiles of the account's own plays (the owner: «опираясь на квинтили»). */
function byBands<T extends { plays: number; last?: string | null }>(list: T[], names: string[], count: (n: number) => string): Section<T>[] {
  const played = list.map((x) => x.plays).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number) => (played.length ? played[Math.min(played.length - 1, Math.floor(f * played.length))]! : 1);
  const th = [q(0.8), q(0.6), q(0.4), q(0.2)];
  const band = (v: number) => (v <= 0 ? 5 : v >= th[0]! ? 0 : v >= th[1]! ? 1 : v >= th[2]! ? 2 : v >= th[3]! ? 3 : 4);
  const word = (n: number) => plural(n, "раз", "раза", "раз");
  const range = (b: number) => {
    if (b === 5) return "ещё не слушал";
    const lo = b === 4 ? 1 : th[b]!, hi = b === 0 ? null : th[b - 1]! - 1;
    return hi == null ? `${lo}+ ${word(lo)}` : lo >= hi ? `${lo} ${word(lo)}` : `${lo}–${hi} ${word(hi)}`;
  };
  const g = new Map<number, T[]>();
  for (const x of list) (g.get(band(x.plays)) ?? g.set(band(x.plays), []).get(band(x.plays))!).push(x);
  return [...g.entries()].sort((a, b) => a[0] - b[0]).map(([b, items]) => ({
    key: "b" + b, name: names[b]!, short: "", sub: `${count(items.length)} · ${range(b)}`,
    items: items.sort((x, y) => y.plays - x.plays || (y.last ?? "").localeCompare(x.last ?? "")),
  }));
}

const letterOf = (s: string) => {
  const c = s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().charAt(0).toUpperCase().replace("Ё", "Е");
  return /[A-Z]/.test(c) ? c : /[А-Я]/.test(c) ? c : /[0-9]/.test(c) ? "0–9" : "#";
};
const letterRank = (k: string) => (/^[A-Z]$/.test(k) ? 0 : /^[А-Я]$/.test(k) ? 1 : k === "0–9" ? 2 : 3);
function byLetters<T>(list: T[], nameOf: (x: T) => string, count: (n: number) => string): Section<T>[] {
  const g = new Map<string, T[]>();
  for (const x of list) { const k = letterOf(nameOf(x)); (g.get(k) ?? g.set(k, []).get(k)!).push(x); }
  return [...g.entries()].sort((a, b) => letterRank(a[0]) - letterRank(b[0]) || a[0].localeCompare(b[0], "ru"))
    .map(([k, items]) => ({ key: "l" + k, name: k, short: k === "0–9" ? "0" : k, sub: count(items.length),
      items: items.sort((x, y) => sortKey(nameOf(x)).localeCompare(sortKey(nameOf(y)), "ru")) }));
}
function group<T extends { plays: number }, K extends string | number>(list: T[], keyOf: (x: T) => K, nameOf: (k: K) => string,
  shortOf: (k: K) => string, order: (a: [K, T[]], b: [K, T[]]) => number, count: (n: number) => string): Section<T>[] {
  const g = new Map<K, T[]>();
  for (const x of list) { const k = keyOf(x); (g.get(k) ?? g.set(k, []).get(k)!).push(x); }
  return [...g.entries()].sort(order).map(([k, items]) => ({ key: String(k), name: nameOf(k), short: shortOf(k), sub: count(items.length),
    items: items.sort((x, y) => y.plays - x.plays) }));
}

export function albumSections(list: AlbumCard[], sort: AlbumSort, lens: Lens, clusters: Map<number, string>): Section<AlbumCard>[] {
  if (sort === "plays") return byBands(list, BANDS_AL, nAlb);
  if (sort === "az") return byLetters(list, (a) => a.title, nAlb);
  if (sort === "new") {
    const s = group(list, (a) => { const d = new Date(a.added); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; },
      (k) => { const [y, m] = k.split("-"); return MONTH[+m! - 1]! + (+y! !== new Date().getFullYear() ? " " + y : ""); },
      (k) => MSHORT[+k.split("-")[1]! - 1]!, (a, b) => b[0].localeCompare(a[0]), nAlb);
    for (const x of s) x.items.sort((a, b) => b.added - a.added || (b.year ?? 0) - (a.year ?? 0));
    return s;
  }
  if (sort === "year") return group(list, (a) => (a.year ? Math.floor(a.year / 10) * 10 : 0), (k) => (k ? `${k}-е` : "Без года"),
    (k) => (k ? "’" + String(k % 100).padStart(2, "0") : "?"), (a, b) => (b[0] || -1) - (a[0] || -1), nAlb);
  if (lens === "sound") return group(list, (a) => a.cluster ?? -1, (k) => clusters.get(k) ?? "Без кластера", () => "", (a, b) => b[1].length - a[1].length, nAlb);
  return group(list, (a) => a.genre, (k) => k, () => "", (a, b) => (a[0] === "Другое" ? 1 : 0) - (b[0] === "Другое" ? 1 : 0) || b[1].length - a[1].length, nAlb);
}

const RN = (() => { try { return new Intl.DisplayNames(["ru"], { type: "region" }); } catch { return null; } })();
const SHORT_RU: Record<string, string> = { US: "США", GB: "Великобритания", AE: "ОАЭ" };
export function countryName(cc: string | null | undefined): string | null {
  if (!cc) return null;
  if (SHORT_RU[cc]) return SHORT_RU[cc]!;
  try { const n = RN?.of(cc); return n && n !== cc ? n : null; } catch { return null; }
}

export function artistSections(list: ArtistCard[], sort: ArtistSort): Section<ArtistCard>[] {
  if (sort === "az") return byLetters(list, (a) => a.name, nArt);
  if (sort === "country") {
    return group(list, (a) => (countryName(a.cc) ? a.cc! : "—"), (k) => (k === "—" ? "Страна не указана" : countryName(k)!), (k) => (k === "—" ? "?" : k),
      (a, b) => (a[0] === "—" ? 1 : 0) - (b[0] === "—" ? 1 : 0) || b[1].length - a[1].length, nArt).map((s) => ({ ...s, cc: s.key === "—" ? undefined : s.key }));
  }
  if (sort === "tracks") {
    const s = group(list, (a) => (a.n >= 50 ? 0 : a.n >= 20 ? 1 : a.n >= 10 ? 2 : 3), (k) => ["50 песен и больше", "20–49 песен", "10–19 песен", "До 10 песен"][k]!,
      () => "", (a, b) => a[0] - b[0], nArt);
    for (const x of s) x.items.sort((a, b) => b.n - a.n);
    return s;
  }
  return byBands(list, BANDS_AR, nArt);
}

export const ALBUM_SORTS: [string, string, string][] = [
  ["plays", "Слушаю чаще", "группами по прослушиваниям"], ["new", "Новые", "по месяцу добавления"], ["az", "А–Я", "по буквам"],
  ["year", "Год", "по десятилетиям"], ["genre:tags", "Жанр по тегам", "из файлов"], ["genre:sound", "Жанр по звучанию", "по сонару вкуса"],
];
export const ARTIST_SORTS: [string, string, string][] = [
  ["plays", "Слушаю чаще", "группами по прослушиваниям"], ["az", "А–Я", "по буквам"], ["country", "По стране", "откуда артист"], ["tracks", "Больше песен", "по числу песен"],
];
