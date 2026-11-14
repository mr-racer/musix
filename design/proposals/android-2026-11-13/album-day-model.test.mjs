// Unit tests for the album of the day model (node --test).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require = createRequire(import.meta.url);
const m = require('./album-day-model.js');
const albums = Object.values(JSON.parse(readFileSync('/mnt/data/musix-snapshots/2026-11-13-android-rebuild/albums.json', 'utf8')));
const album = name => albums.find(a => a.album.startsWith(name)).tracks;
const withPlays = (tracks, heard) => tracks.map((t, i) => ({...t, plays: i < heard ? 1 : 0}));

test('progress counts MBDTF: 7 of 11 heard, finish on the 9th', () => {
  const p = m.adProgress(withPlays(album('My Beautiful'), 7));
  assert.deepEqual({heard: p.heard, total: p.total, finishAt: p.finishAt, left: p.left, done: p.done},
    {heard: 7, total: 11, finishAt: 9, left: 2, done: false});
});

test('songs of 60 s or shorter do not count', () => {
  const foals = album('Everything Not Saved');
  const short = foals.filter(t => t.d <= 60).length;
  assert.ok(short >= 1, 'fixture has short tracks');
  assert.equal(m.adProgress(withPlays(foals, 0)).total, foals.length - short);
  assert.equal(m.adCountable(foals).every(t => t.d > 60), true);
});

test('9 of 11 is done', () => {
  assert.equal(m.adProgress(withPlays(album('My Beautiful'), 9)).done, true);
});

test('button labels', () => {
  const t = album('My Beautiful');
  assert.equal(m.adButtonLabel(m.adProgress(withPlays(t, 0))), 'Слушать');
  assert.equal(m.adButtonLabel(m.adProgress(withPlays(t, 7))), 'Дослушать · 7 из 11');
  assert.equal(m.adButtonLabel(m.adProgress(withPlays(t, 9))), 'Ещё раз');
});

test('progress phrase', () => {
  const t = album('My Beautiful');
  assert.match(m.adProgressPhrase(m.adProgress(withPlays(t, 7)), 0), /<b>2 песни<\/b>/);
  assert.equal(m.adProgressPhrase(m.adProgress(withPlays(t, 8))), 'Последняя песня до финиша');
  assert.equal(m.adProgressPhrase(m.adProgress(withPlays(t, 9))), null);
  assert.equal(m.adProgressPhrase(m.adProgress(withPlays(t, 0))), null);
});

test('never: gendered and «затёрты» templates need their facts', () => {
  const plain = m.adPhrases('never', {artist: 'Foals', rank: 4, hours: 12, artistGender: null, otherAlbumsHeard: 1}).join('\n');
  assert.doesNotMatch(plain, /старал/);
  assert.doesNotMatch(plain, /затёрты/);
  assert.match(plain, /<b>№4<\/b>/);
  const full = m.adPhrases('never', {artist: 'Foals', rank: 4, hours: 12, artistGender: 'group', otherAlbumsHeard: 2}).join('\n');
  assert.match(full, /старались, записывали/);
  assert.match(full, /а этот как новенький/);
});

test('one and long kinds fill their numbers', () => {
  const one = m.adPhrases('one', {song: 'Frozen', n: 47, k: 12});
  assert.ok(one.some(s => s.includes('«Frozen» играла <b>47 раз</b>. Остальные 12 песен ревнуют')));
  assert.ok(one.includes('Одна песня на репите — это любовь. Целый альбом — уже отношения'));
  const long = m.adPhrases('long', {plays: 32, monthGen: 'марта', days: 246});
  assert.ok(long.includes('<b>32 раза</b>, а потом тишина с марта. Что случилось?'));
  assert.ok(long.includes('<b>246 дней</b> без этого альбома. Он считал'));
});

test('quote shortens inside the quotes', () => {
  const q = m.adQuote('Monster (ft. Jay-Z, Rick Ross, Nicki Minaj & Bon Iver)', 24);
  assert.ok(q.length <= 26, q);
  assert.ok(q.endsWith('…»'), q);
  assert.equal(m.adQuote('Frozen', 24), '«Frozen»');
});

test('next index never repeats the previous one', () => {
  assert.notEqual(m.adNextIndex(5, 2, () => 0.45), 2);
  assert.equal(m.adNextIndex(1, 0, () => 0.9), 0);
});

test('finale phrases', () => {
  assert.deepEqual(m.adFinalePhrases(), ['Обыграна! От первой песни до последней', 'Обыграна! Альбом пройден, можно хвастаться']);
});
test('never: a long artist name shortens with artistMax, a short one stays', () => {
  const f = {artist: 'Everything Everything Orchestra', rank: 4, hours: 12, artistGender: 'group', otherAlbumsHeard: 1};
  const short = m.adPhrases('never', {...f, artistMax: 14});
  assert.ok(short.every(s => s.includes('Everything Ev…') && !s.includes('Orchestra')), JSON.stringify(short));
  assert.ok(m.adPhrases('never', {...f, artist: 'Foals', artistMax: 14})[0].startsWith('Foals у тебя'));
});
