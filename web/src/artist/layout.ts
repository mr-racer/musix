import { plural } from "../lib/format";
import type { Album } from "./model";

/** A square photo's left edge, continued to the frame's left edge (design/reference/artist,
 *  round 5): the visible crop of the photo (cover, 50% 20%) → its leftmost ~1 % averaged row by
 *  row into one column, padded with its end rows, then spread to the left with a vertical blur
 *  that grows with the distance in px (0.6 px per px; none at the photo's edge, so the photo
 *  meets its own colour exactly; wide far left, so a contour crossing the edge turns into soft
 *  light, not streaks). Drawn into a 160-column canvas the CSS stretches; → the photo's left
 *  offset for the dimming, or null when the pixels cannot be read. */
export function extendEdge(cv: HTMLCanvasElement, photo: HTMLElement, im: HTMLImageElement): number | null {
  const bw = photo.offsetWidth, bh = photo.offsetHeight, pl = photo.offsetLeft, iw = im.naturalWidth, ih = im.naturalHeight;
  if (!bw || !bh || !iw || !ih) return null;
  const k = Math.max(bw / iw, bh / ih), sx = -((bw - iw * k) * 0.5) / k, sy = -((bh - ih * k) * 0.2) / k;
  const R = 160, P = 48, H2 = R + 2 * P;
  const col = document.createElement("canvas");
  col.width = 1; col.height = R;
  const c = col.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.imageSmoothingQuality = "high";
  c.drawImage(im, sx, sy, Math.max(1, (bw / k) * 0.012), bh / k, 0, 0, 1, R);
  let src: Uint8ClampedArray;
  try { src = c.getImageData(0, 0, 1, R).data; } catch { return null; } // a cross-origin picture: no continuation
  const pre = new Float64Array((H2 + 1) * 3);
  for (let y = 0; y < H2; y++) {
    const q = Math.min(R - 1, Math.max(0, y - P)) * 4;
    for (let ch = 0; ch < 3; ch++) pre[(y + 1) * 3 + ch] = pre[y * 3 + ch]! + src[q + ch]!;
  }
  const ramp = bw * 0.08, E = pl + 40 + ramp, C = 160, under = (C * ramp) / E; // the columns under the photo's ramp stay sharp
  cv.width = C; cv.height = H2;
  const g = cv.getContext("2d");
  if (!g) return null;
  const out = g.createImageData(C, H2), o = out.data;
  for (let x = 0; x < C; x++) {
    const dist = (Math.max(0, C - under - x) / C) * E, r = Math.round(Math.min(dist * 0.6, bh * 0.4) / (bh / R));
    for (let y = 0; y < H2; y++) {
      const a = Math.max(0, y - r), b = Math.min(H2, y + r + 1), n = b - a, i = (y * C + x) * 4;
      for (let ch = 0; ch < 3; ch++) o[i + ch] = (pre[b * 3 + ch]! - pre[a * 3 + ch]!) / n;
      o[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  Object.assign(cv.style, { left: "-40px", width: `${E}px`, top: `${-(P / R) * bh}px`, height: `${(bh * H2) / R}px` });
  return pl;
}

export type TLItem = { al: Album; i: number; up: boolean; x: number; tx: number; top: number; ys: number };
export type TL = {
  W: number; H: number; S: number; axisY: number; lanes: number;
  items: TLItem[]; ticks: { x: number; dec: boolean; label: string | null }[];
  breaks: { x: number; label: string; flip: boolean }[]; events: { x: number; year: number; text: string }[];
};

/** The discography in time (logic.js `layoutTL`): years to x, piecewise, with stretches over six
 *  empty years folded into a break («18 лет») so the albums keep the width; two lanes over and
 *  under the axis from four albums; a sleeve keeps to its year with a stem when it must move. */
export function layoutTimeline(W: number, albums: Album[], o: { start: number | null; formedYear: number | null; end: number | null; dead: boolean; band: boolean }): TL | null {
  const all = albums.filter((a) => a.year);
  const n = all.length;
  if (!n || W < 200) return null;
  const lanes = n <= 3 ? 1 : 2;
  const S = Math.round(Math.min(172, Math.max(108, (W - 40) / Math.ceil(n / lanes) - 34)));
  const meta = 62, gap = 30, laneH = S + meta + gap, axisY = laneH + 6, H = lanes === 2 ? laneH * 2 + 12 : laneH + 40;
  const y0 = Math.min(o.start ?? all[0]!.year!, all[0]!.year!) - 1, y1 = Math.max(all[n - 1]!.year!, o.end ?? (o.dead ? all[n - 1]!.year! : new Date().getFullYear())) + 1;
  const anchors = [...new Set([y0, ...(o.formedYear ? [o.formedYear + 0.5] : []), ...all.map((x) => x.year! + 0.5), ...(o.dead && o.end ? [o.end + 0.5] : []), y1])].sort((p, q) => p - q);
  const G = 6, CMP = 2.4;
  const segs: { p: number; q: number; br: boolean; s: number; e: number }[] = [];
  let tot = 0;
  for (let k = 0; k < anchors.length - 1; k++) {
    const p = anchors[k]!, q = anchors[k + 1]!, br = q - p > G;
    segs.push({ p, q, br, s: tot, e: br ? CMP : q - p });
    tot += br ? CMP : q - p;
  }
  const pad = S / 2 + 4;
  const X = (y: number) => {
    const g = segs.find((s) => y >= s.p && y <= s.q) ?? (y < anchors[0]! ? segs[0]! : segs[segs.length - 1]!);
    return pad + ((g.s + ((y - g.p) / (g.q - g.p)) * g.e) / tot) * (W - 2 * pad);
  };
  const inBreak = (y: number) => segs.some((s) => s.br && y > s.p + 0.3 && y < s.q - 0.3);
  const lanesOf: TLItem[][] = [[], []];
  const items = all.map((al, i): TLItem => {
    const lane = lanes === 2 ? i % 2 : 0, up = lane === 0, tx = X(al.year! + 0.5);
    const it = { al, i, up, tx, x: tx, top: up ? axisY - gap - meta - S : axisY + gap, ys: up ? axisY - gap + 4 : axisY + gap - 4 };
    lanesOf[lane]!.push(it);
    return it;
  });
  for (const lane of lanesOf) {
    for (let k = 0; k < lane.length; k++) lane[k]!.x = Math.max(lane[k]!.tx, k ? lane[k - 1]!.x + S + 26 : S / 2);
    for (let k = lane.length - 1; k >= 0; k--) lane[k]!.x = Math.min(lane[k]!.x, k < lane.length - 1 ? lane[k + 1]!.x - S - 26 : W - S / 2);
  }
  const ticks: TL["ticks"] = [];
  const now = new Date().getFullYear();
  for (let y = Math.ceil(y0); y <= y1; y++) {
    if (inBreak(y)) continue;
    const dec = y % 10 === 0, last = y === Math.floor(y1);
    const nearEv = !!o.formedYear && Math.abs(y - o.formedYear) < 3 && !last;
    ticks.push({ x: X(y), dec, label: !nearEv && (dec || last) ? (last && !o.dead && y >= now ? "сейчас" : String(y)) : null });
  }
  const events: TL["events"] = [];
  if (o.formedYear && o.formedYear >= y0) events.push({ x: X(o.formedYear + 0.5), year: o.formedYear, text: o.band ? "группа собралась" : "начало" });
  if (o.dead && o.end) events.push({ x: X(o.end + 0.5), year: o.end, text: "✝" });
  // a break's «N лет» moves to the other side of the axis when an event's chip stands next to it
  const breaks = segs.filter((g) => g.br).map((s) => {
    const yrs = Math.round(s.q - s.p), x = X((s.p + s.q) / 2);
    return { x, label: `${yrs} ${plural(yrs, "год", "года", "лет")}`, flip: events.some((e) => Math.abs(e.x - x) < 110) };
  });
  return { W, H, S, axisY, lanes, items, ticks, breaks, events };
}
