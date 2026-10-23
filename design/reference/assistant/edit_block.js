/* What the mock writes by hand: example texts the server does not produce yet (the playlist's
   few words), better follow-ups where the real ones were weak, links in answers. */
const EDIT = (() => {
  const D = window.DATA, T = D.tracks;
  const byTitle = (t) => Object.values(T).find((x) => x.t.toLowerCase().startsWith(t.toLowerCase()));
  const top = (slug) => D.top.find((a) => a.slug === slug);
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const artistsOf = (ids) => { const c = {}; for (const id of ids) { const a = T[id].a.split(/,| & | feat\.| ft\.| x /)[0].trim(); c[a] = (c[a] || 0) + 1; } return Object.entries(c).sort((x, y) => y[1] - x[1]).map((x) => x[0]); };
  const names = D.top.map((a) => a.name).sort((a, b) => b.length - a.length);
  const ALBUM = {
    "The Life of Pablo": "«The Life of Pablo» вышел в феврале 2016 года и первым поднялся на вершину Billboard 200 почти целиком за счёт стриминга. Канье ещё несколько месяцев менял трек-лист и сведение уже после релиза — альбом называли «живым».",
    Starboy: "«Starboy» вышел в ноябре 2016 года: The Weeknd постригся, сменил образ и записал заглавную песню с Daft Punk. Альбом получил «Грэмми» как лучший урбан-альбом.",
  };
  return {
    blurb: {
      kanye: "От «Stronger» с сэмплом Daft Punk до «Power» и «All of the Lights» — песни, которыми Канье держал нулевые, и пара новых с «Vultures».",
      producer: (it) => { const a = artistsOf(it.tracks); return `${it.tracks.length} ${plural(it.tracks.length, "песня", "песни", "песен")} у ${a.length} ${plural(a.length, "артиста", "артистов", "артистов")} — от ${a[0]} до ${a[a.length - 1]}. Сначала те, что ты слушаешь чаще.`; },
      generic: (it) => { const a = artistsOf(it.tracks); return `${it.tracks.length} ${plural(it.tracks.length, "песня", "песни", "песен")}${a.length > 1 ? ` у ${a.length} ${plural(a.length, "артиста", "артистов", "артистов")}` : ""}, сначала самые заслушанные.`; },
    },
    coverOf: (t) => byTitle(t)?.c,
    subj: (slug) => { const a = top(slug); return a ? { name: a.name, photo: a.photo, sub: `№${D.top.indexOf(a) + 1} среди твоих артистов` } : null; },
    follow: {
      twodoor: ["Хиты Two Door Cinema Club", "Похожее по звуку на «What You Know»", "Кто ещё назвал группу в честь места?"],
      generic: (it) => it.artist ? [`Хиты ${it.artist.name}`, `История ${it.artist.name}`] : it.track ? [`Кто продюсировал «${T[it.track].t}»?`, `Похожее по звуку на «${T[it.track].t}»`] : it.title ? [`Хиты ${it.title}`, `Похожее на ${it.title}`] : [],
    },
    more: "",
    yearText: (it) => ALBUM[it.title] || `«${it.title}» вышел ${it.years} лет назад.`,
    refine: { playlist: ["Только старое, до 2010", "Без фитов", "Ещё 10 песен", "Спокойнее"], audio: ["Ещё спокойнее", "Только без слов", "Похожее, но новое для меня"] },
    weakLine: "совпадение по смыслу, не по словам",
    stronger: "«Stronger» построен на сэмпле «Harder, Better, Faster, Stronger» Daft Punk — а та сама берёт кусок из «Cola Bottle Baby» Эдвина Бёрдсонга 1979 года. Канье пересводил песню больше 70 раз, пока бочка не зазвучала так, как он хотел.",
    link: (html) => { let out = html; for (const n of names) { const i = out.indexOf(n); if (i >= 0 && !out.slice(0, i).includes(`>${n}<`)) { out = out.slice(0, i) + `<a href="#" data-toast="Откроется ${n}">${n}</a>` + out.slice(i + n.length); } } return out; },
    order: (cs) => { const by = {}; for (const c of cs) (by[c.kind] = by[c.kind] || []).push(c); const out = []; const ks = ["producer", "story", "name", "year", "guest"]; for (let i = 0; out.length < cs.length && i < 20; i++) for (const k of ks) if (by[k]?.[i]) out.push(by[k][i]); return out; },
  };
})();
window.EDIT = EDIT;
