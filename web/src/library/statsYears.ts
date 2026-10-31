/** The year landscape is prepared once for each statistics snapshot. */
export function statsYears(years: { year: number; tracks: number }[]) {
  const ys = years.map((y) => [y.year, y.tracks] as const);
  if (ys.length < 2) return null;
  const raw = new Map(ys);
  const y0 = Math.min(...ys.map((y) => y[0])), y1 = Math.max(...ys.map((y) => y[0]));
  const xs: number[] = []; for (let y = y0; y <= y1; y++) xs.push(y);
  const sm = xs.map((y) => [1, 2, 3, 2, 1].reduce((a, w, k) => a + w * (raw.get(y - 2 + k) ?? 0), 0) / 9);
  const mx = Math.max(...sm, 1), X = (y: number) => ((y - y0) / Math.max(1, y1 - y0)) * 1000, Y = (v: number) => 200 - (v / mx) * 176;
  const pts = xs.map((y, i) => [X(y), Y(sm[i]!)] as const);
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 2] ?? pts[i - 1]!, p1 = pts[i - 1]!, p2 = pts[i]!, p3 = pts[i + 1] ?? p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const pk = ys.reduce((a, b) => (b[1] > a[1] ? b : a));
  const decs: number[] = []; for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) decs.push(y);
  return { y0, y1, raw, sm, mx, X, Y, d, pk, decs, xs };
}
