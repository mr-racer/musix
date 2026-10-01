/** v1's fact classes: the most specific label names the card, its hue colours it. */
const CLASSES: [string, string, number][] = [
  ["sample", "сэмпл", 170], ["name_origin", "название", 125], ["title_origin", "название", 125],
  ["trouble", "спор", 15], ["record", "рекорд", 45], ["award", "награда", 90], ["video", "клип", 335],
  ["placement", "где звучит", 140], ["sound", "звук", 215], ["creation", "создание", 75],
  ["personal", "личное", 350], ["band_history", "история", 55],
];

export function factClass(labels: string[]): { label: string; hue: number } | null {
  const hit = CLASSES.find(([k]) => labels.includes(k));
  return hit ? { label: hit[1], hue: hit[2] } : null;
}
