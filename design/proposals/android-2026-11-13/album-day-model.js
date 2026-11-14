/* Album of the day, phone round 2: progress and phrases as pure functions.
 * Songs of 60 s or shorter (skits, intros) never count. The album is played through at
 * 75 % of the counted songs, in any order. Copy is the spec's, word for word. */
const AD_SKIT_S = 60, AD_FINISH = 0.75;
function adPlural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  return forms[b === 1 && a !== 11 ? 0 : b >= 2 && b <= 4 && (a < 12 || a > 14) ? 1 : 2];
}
const adNum = (n, forms) => `${n} ${adPlural(n, forms)}`;
const AD_SONGS = ['песня', 'песни', 'песен'], AD_TIMES = ['раз', 'раза', 'раз'];
function adCountable(tracks) { return tracks.filter(t => t.d > AD_SKIT_S); }
function adProgress(tracks) {
  const counted = adCountable(tracks), total = counted.length;
  const heard = counted.filter(t => (t.plays || 0) > 0).length;
  const finishAt = Math.ceil(AD_FINISH * total), left = Math.max(0, finishAt - heard);
  return { heard, total, finishAt, left, fraction: total ? heard / total : 0, done: total > 0 && heard >= finishAt };
}
function adButtonLabel(p) {
  if (p.done) return 'Ещё раз';
  return p.heard === 0 ? 'Слушать' : `Дослушать · ${p.heard} из ${p.total}`;
}
/* variant picks between the two mid-way lines; the card passes its own counter. */
function adProgressPhrase(p, variant = 0) {
  if (p.heard === 0 || p.done) return null;
  if (p.left === 1) return 'Последняя песня до финиша';
  const left = `Ещё <b>${adNum(p.left, AD_SONGS)}</b> — и пластинка обыграна`;
  return p.heard >= p.total / 2 && variant % 2 === 1 ? 'Половина позади. Не сворачивай' : left;
}
function adQuote(title, max = 99) {
  const s = String(title);
  return s.length <= max ? `«${s}»` : `«${s.slice(0, Math.max(1, max - 1)).trimEnd()}…»`;
}
/* A name too long for two lines is cut with an ellipsis; no quotes, it is a name. */
function adName(name, max = 99) {
  const s = String(name);
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function adPhrases(kind, f) {
  if (kind === 'one') {
    const q = adQuote(f.song, f.songMax);
    return [
      `${q} играла <b>${adNum(f.n, AD_TIMES)}</b>. Остальные ${f.k} ${adPlural(f.k, AD_SONGS)} ревнуют`,
      `${q} уже можно петь с закрытыми глазами. Теперь открой их на остальные <b>${f.k}</b>`,
      `<b>${adNum(f.n, AD_TIMES)}</b> ${q} — это уже не песня, а прописка`,
      'Одна песня на репите — это любовь. Целый альбом — уже отношения',
      `Раз ${q} так заходит, представь, что прячется в соседних <b>${f.k} ${adPlural(f.k, ['треке', 'треках', 'треках'])}</b>`,
    ];
  }
  if (kind === 'never') {
    const a = adName(f.artist, f.artistMax);
    const out = [
      `${a} у тебя <b>№${f.rank}</b>, а этот альбом всё ещё в плёнке`,
      `<b>${adNum(f.hours, ['час', 'часа', 'часов'])}</b> с ${a} — и ни минуты отсюда. Непорядок`,
    ];
    const verbs = { m: 'старался, записывал', f: 'старалась, записывала', group: 'старались, записывали' }[f.artistGender];
    if (verbs) out.push(`${a} ${verbs}, а ты даже не открыл`);
    if ((f.otherAlbumsHeard || 0) >= 2) out.push(`Все альбомы ${a} затёрты до дыр, а этот как новенький`);
    return out;
  }
  if (kind === 'long') {
    return [
      `<b>${adNum(f.plays, AD_TIMES)}</b>, а потом тишина с ${f.monthGen}. Что случилось?`,
      `<b>${adNum(f.days, ['день', 'дня', 'дней'])}</b> без этого альбома. Он считал`,
      'На пластинке уже слой пыли. Лучшая тряпочка — проигрыватель',
      `Старый друг лучше новых двух. Особенно после <b>${adNum(f.plays, ['прослушивания', 'прослушиваний', 'прослушиваний'])}</b>`,
    ];
  }
  return [];
}
function adFinalePhrases() { return ['Обыграна! От первой песни до последней', 'Обыграна! Альбом пройден, можно хвастаться']; }
function adNextIndex(len, prev, rnd = Math.random) {
  if (len <= 1) return 0;
  const i = Math.floor(rnd() * (len - 1));
  return i >= prev ? i + 1 : i;
}
if (typeof module !== 'undefined') module.exports = { adPlural, adCountable, adProgress, adButtonLabel, adProgressPhrase, adQuote, adName, adPhrases, adFinalePhrases, adNextIndex };
