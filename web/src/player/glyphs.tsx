/** Instrument glyphs on a 24 grid, drawn like the app's own icons (ui/icons.tsx): 1.7 stroke,
 *  round caps, a filled part where the shape needs mass. One set for the «Звучат» chips (SVG)
 *  and the sound stage (Canvas Path2D). The owner, 2026-10-25: instrument names in text were
 *  «перегружено»; a glyph says it at a glance and the name comes on hover. */
export type Glyph = { d: string; fill?: boolean }[];

const GUITAR: Glyph = [
  { d: "M10.6 10.4c-1.3-1.3-3.4-1.2-4.4.4-.4.7-1.2 1-1.8 1.5-1.4 1.3-1.1 3.7.7 5.4 1.7 1.8 4.1 2.1 5.4.7.5-.6.8-1.4 1.5-1.8 1.6-1 1.7-3.1.4-4.4z" },
  { d: "M7 14.8a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0" },
  { d: "M10.4 12.6 18 5" },
  { d: "M17.2 3.6l3.2 3.2" },
];
const CLEF: Glyph = [
  { d: "M5.5 9.5a4.5 4.5 0 0 1 9 0c0 4.8-4.2 8.2-9 10" },
  { d: "M5.1 9.6a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0", fill: true },
  { d: "M17 7.6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0", fill: true },
  { d: "M17 11.6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0", fill: true },
];
const SUB: Glyph = [ // a speaker cone: the 808's boom
  { d: "M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0" },
  { d: "M7.5 12a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0" },
  { d: "M10.7 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0", fill: true },
];
const WAVE: Glyph = [{ d: "M2.5 12c1.2-4.5 3.3-4.5 4.75 0s3.55 4.5 4.75 0 3.3-4.5 4.75 0 3.55 4.5 4.75 0" }];
const VIOLIN: Glyph = [
  { d: "M10.7 3.6a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0" },
  { d: "M12 4.9V9" },
  { d: "M9.3 9c-1.6 0-2.3 1.5-1.5 2.8.5.8.4 1.5-.3 2.2-1.4 1.4-.6 4.8 4.5 4.8s5.9-3.4 4.5-4.8c-.7-.7-.8-1.4-.3-2.2.8-1.3.1-2.8-1.5-2.8-.9 0-1.6.5-2.7.5S10.2 9 9.3 9z" },
  { d: "M10.2 13.4v2.3M13.8 13.4v2.3" },
];
const TRUMPET: Glyph = [
  { d: "M2.8 10.2v3.6M2.8 12h12.7" },
  { d: "M15.5 10.6 21 8v8l-5.5-2.6" },
  { d: "M8.5 12V8.6M11 12V8.6M13.5 12V8.6" },
  { d: "M7.8 8.6h1.4M10.3 8.6h1.4M12.8 8.6h1.4" },
  { d: "M7 12v2.2c0 1.2.8 2 2 2h5c1.2 0 2-.8 2-2" },
];
const SAX: Glyph = [
  { d: "M8 3.5h3.2c.9 0 1.6.4 2 1.1l1.3 2.1" },
  { d: "M14.5 6.7v8.3a4.5 4.5 0 0 1-9 0v-1" },
  { d: "M4 14h3.4" },
  { d: "M13.6 9.5a.9.9 0 1 0 1.8 0a.9.9 0 1 0 -1.8 0M13.6 12.5a.9.9 0 1 0 1.8 0a.9.9 0 1 0 -1.8 0", fill: true },
];
const PIANO: Glyph = [
  { d: "M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6z" },
  { d: "M7.5 12.5V18M12 12.5V18M16.5 12.5V18" },
  { d: "M6.4 6h2.2v6.5H6.4zM10.9 6h2.2v6.5h-2.2zM15.4 6h2.2v6.5h-2.2z", fill: true },
];
const ORGAN: Glyph = [
  { d: "M4 20v-7.5a1.2 1.2 0 0 1 2.4 0V20M8.6 20V8.5a1.2 1.2 0 0 1 2.4 0V20M13.2 20V6a1.2 1.2 0 0 1 2.4 0v14M17.8 20V10a1.2 1.2 0 0 1 2.4 0v10" },
  { d: "M3 20.2h18" },
];
const SYNTH: Glyph = [
  { d: "M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5z" },
  { d: "M3 11h18M7.5 11v8M12 11v8M16.5 11v8" },
  { d: "M6 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0M10 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0", fill: true },
  { d: "M14.8 8h3.4" },
];
const SNARE: Glyph = [
  { d: "M4 10.5a8 2.8 0 1 0 16 0a8 2.8 0 1 0 -16 0" },
  { d: "M4 10.5V16c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-5.5" },
  { d: "M8 13.4v4.4M16 13.4v4.4" },
  { d: "M13.6 8.2 19 3M10.4 8.2 5 3" },
];
const PADS: Glyph = [
  { d: "M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z" },
  { d: "M13.4 7h3.6v3.6h-3.6zM7 13.4h3.6V17H7zM13.4 13.4h3.6V17h-3.6z" },
  { d: "M7 7h3.6v3.6H7z", fill: true },
];
const MIC: Glyph = [
  { d: "M12 3.5a2.8 2.8 0 0 0-2.8 2.8v4.9a2.8 2.8 0 0 0 5.6 0V6.3A2.8 2.8 0 0 0 12 3.5z" },
  { d: "M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5v4M9 20.5h6" },
];
const HANDMIC: Glyph = [ // rap: the hand-held mic
  { d: "M4.5 8.5a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" },
  { d: "M5.7 5.7l5.6 5.6" },
  { d: "M11.4 12.3 17.6 18.5a1.3 1.3 0 0 0 1.9-1.8l-6.3-6.2" },
];
const NOTE: Glyph = [
  { d: "M9 17.5V6l10-2v11" },
  { d: "M4.5 17.5a2.5 2 0 1 0 5 0a2.5 2 0 1 0 -5 0M14.5 15a2.5 2 0 1 0 5 0a2.5 2 0 1 0 -5 0", fill: true },
];
const HEADPHONES: Glyph = [
  { d: "M4 15v-3a8 8 0 0 1 16 0v3" },
  { d: "M4 14.5h2.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM20 14.5h-2.5a1 1 0 0 0-1 1v3.5a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1z" },
];

const BY: Record<string, Glyph> = {
  guitar: GUITAR, electric_guitar: GUITAR, acoustic_guitar: GUITAR, slide_guitar: GUITAR, banjo: GUITAR, mandolin: GUITAR, ukulele: GUITAR, sitar: GUITAR,
  bass: CLEF, bass_guitar: CLEF, double_bass: CLEF, bass_808: SUB, synth_bass: WAVE,
  strings: VIOLIN, harp: VIOLIN, brass: TRUMPET, winds: SAX, sax: SAX, woodwind: SAX, harmonica: SAX, bagpipes: SAX, accordion: PIANO,
  piano: PIANO, electric_piano: PIANO, harpsichord: PIANO, keys: PIANO, organ: ORGAN,
  synthesizer: SYNTH, synths: SYNTH, synth_other: SYNTH, lead: SYNTH, theremin: WAVE,
  drums: SNARE, drums_live: SNARE, drum_machine: PADS, kick: SNARE, snare: SNARE, toms: SNARE, hihat: SNARE, cymbals: SNARE,
  voice: MIC, vocal: MIC, male: MIC, female: MIC, singing: MIC, choir: MIC, processed_voice: MIC, rap: HANDMIC, rap_singing: HANDMIC,
  listener: HEADPHONES,
};
export const glyph = (key: string): Glyph => BY[key] ?? NOTE;

export function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {glyph(name).map((p, i) => <path key={i} d={p.d} fill={p.fill ? "currentColor" : "none"} stroke={p.fill ? "none" : undefined} />)}
    </svg>
  );
}
