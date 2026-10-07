export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10, d100 = n % 100;
  return d10 === 1 && d100 !== 11 ? one : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? few : many;
}

export const num = (n: number) => n.toLocaleString("en-US");

/** «230ч 33м» (v1's stats readout). */
export function hoursMinutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}ч ${m % 60}м` : `${m}м`;
}

/** «8 ч 59 м», «41 мин» (the home's week readout; design/reference/home). */
export function hoursMinutesWide(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} м` : `${m} мин`;
}
