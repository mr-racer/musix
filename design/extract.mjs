// Extract design tokens from v1's source of truth (read-only), so tokens stay
// traceable to the code they came from:
//   - colors: the useColors() palettes in frontend/packages/musix-ui/src/index.jsx,
//     evaluated for both themes;
//   - motion: the easing curves and durations most used in musix-ui/styles.css + main.jsx;
//   - radius / blur: the most used border-radius and backdrop blur values.
// Hand-added tokens (inline-style-only values) live in tokens/manual.json.
// Usage: node design/extract.mjs  (from v2/)
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = new URL('../../', import.meta.url).pathname;
const ui = readFileSync(REPO + 'frontend/packages/musix-ui/src/index.jsx', 'utf8');
const css = readFileSync(REPO + 'frontend/packages/musix-ui/styles.css', 'utf8');
const app = readFileSync(REPO + 'frontend/src/main.jsx', 'utf8');

const body = ui.match(/export function useColors\(isDark\) \{\s*return useMemo\(\(\) => \((\{[\s\S]*?\})\), \[isDark\]\);/)[1];
const palette = new Function('isDark', `return (${body});`);
const dark = palette(true), light = palette(false);
const color = {};
for (const k of Object.keys(dark)) {
  const src = 'musix-ui useColors()';
  color[k] = dark[k] === light[k]
    ? { $type: typeOf(dark[k]), $value: dark[k], $description: src }
    : { $type: typeOf(dark[k]), $value: { dark: dark[k], light: light[k] }, $description: src };
}
function typeOf(v) { return /gradient/.test(v) ? 'gradient' : 'color'; }

const count = (re, text) => {
  const m = {};
  for (const x of text.matchAll(re)) { const v = x[1].replace(/\s+/g, ''); m[v] = (m[v] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
// Same curve, different spelling (".22,.9,.3,1" vs "0.22, 0.9, 0.3, 1"): key by the numbers.
const easing = Object.entries(Object.fromEntries(Object.entries(
  count(/cubic-bezier\(([^)]*)\)/g, css + app).reduce((m, [v, n]) => {
    const k = v.split(',').map(Number).join(','); m[k] = (m[k] || 0) + n; return m; }, {})))
).sort((a, b) => b[1] - a[1]).slice(0, 5);
const names = ['standard', 'spring', 'swift', 'emphasized', 'symmetric'];
const motion = { easing: {}, duration: {} };
easing.forEach(([v, n], i) => {
  motion.easing[names[i]] = { $type: 'cubicBezier', $value: v.split(',').map(Number), $description: `used ${n}× in styles.css + main.jsx` };
});
const durs = count(/(?:transition|animation)[^;{}]*?(\d{2,4})ms/g, css + app).slice(0, 6);
durs.forEach(([v, n]) => { motion.duration[`d${v}`] = { $type: 'duration', $value: `${v}ms`, $description: `used ${n}×` }; });

const radius = {};
count(/border-?[rR]adius:\s*'?(\d{1,2})px/g, css + app).slice(0, 8)
  .sort((a, b) => a[0] - b[0])
  .forEach(([v, n]) => { radius[`r${v}`] = { $type: 'dimension', $value: `${v}px`, $description: `used ${n}×` }; });
const blur = {};
count(/blur\((\d{1,2})px\)/g, css + app).slice(0, 5)
  .sort((a, b) => a[0] - b[0])
  .forEach(([v, n]) => { blur[`b${v}`] = { $type: 'dimension', $value: `${v}px`, $description: `backdrop/filter blur, used ${n}×` }; });

const write = (f, o) => writeFileSync(new URL(`tokens/${f}`, import.meta.url), JSON.stringify(o, null, 2) + '\n');
write('color.json', { color });
write('motion.json', { motion });
write('shape.json', { radius, blur });
console.log(`colors ${Object.keys(color).length}, easing ${easing.length}, durations ${durs.length}, radii ${Object.keys(radius).length}, blur ${Object.keys(blur).length}`);
