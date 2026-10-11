import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Schemas } from "../api/client";
import { statsQuery } from "../api/queries";
import { plural } from "../lib/format";
import { image, imageUrl } from "../lib/images";
import { useAchievementPop, ROT, stickerSvg } from "../ui/Achievements";
import { Icon } from "../ui/icons";
import { playArtist } from "./actions";
import { flagUrl } from "./flags";
import { countryName, genreRu } from "./model";
import { fromTrack, player } from "../player/engine";
import { flyToMini } from "../player/MiniPlayer";
import css from "./stats.module.css";

/** The library's statistics (design/code/screens/library.md; the mock's variant А after the
 *  owner's three rounds of fixes). The accent is the favourite song's cover colour (--fav). */

type St = Schemas["StatsOut"];
type Ach = Schemas["AchievementOut"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const ru = (iso: string) => { const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const num = (n: number) => Math.round(n).toLocaleString("ru-RU");
const dec1 = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
const nx = (n: number, a: string, b: string, c: string) => `${num(n)} ${plural(Math.round(n), a, b, c)}`;
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Comparisons for the time: from space to dumplings; several with a wink (the owner liked
 *  «Is this the real life» and asked for more such). */
function phrases(H: number, plays: number, top: string): string[] {
  const times = (x: number) => { const r = Math.round(x * 2) / 2; if (r < 1) return "почти целиком"; return r % 1 ? `${Math.floor(r)},5 раза` : `${r} ${plural(r, "раз", "раза", "раз")}`; };
  const km = H * 5, walk = ([["до Твери", 180], ["до Петербурга", 710], ["до Минска", 720], ["до Варшавы", 1260], ["до Берлина", 1820], ["до Парижа", 2850]] as const).filter((w) => km > w[1]).at(-1);
  const hours = `${num(H)} ${plural(Math.round(H), "час", "часа", "часов")}`;
  return [
    `Это как <b>долететь до Луны</b> ${times(H / 76)}`,
    `Можно было бы сварить <b>${nx((H * 60) / 8, "кастрюлю", "кастрюли", "кастрюль")} пельменей</b>. По восемь минут, с лавровым листом`,
    `<b>«Bohemian Rhapsody»</b> ${nx((H * 60) / 5.92, "раз", "раза", "раз")} подряд. Is this the real life? Да, это твоя статистика`,
    `<b>«Never Gonna Give You Up»</b> ${nx((H * 60) / 3.55, "раз", "раза", "раз")} подряд. Тебя бы зарикроллили на всю жизнь вперёд`,
    `«4′33″» Джона Кейджа <b>${nx((H * 60) / 4.55, "раз", "раза", "раз")}</b> подряд — и ни одной ноты`,
    H < 264.4 ? `Ещё <b>${dec1(264.4 - H)} ч</b> — и ты перекроешь рекорд Рэнди Гарднера: 264 часа без сна. Он, правда, обходился без музыки`
      : "Ты перекрыл рекорд Рэнди Гарднера: <b>264 часа</b> без сна. Только он не спал, а ты слушал",
    `Ленивец за это время прополз бы <b>${num(H * 0.24)} км</b>. Медленно, но под хороший бит`,
    `Это <b>${nx(H / 1.5, "пара", "пары", "пар")}</b> по полтора часа. Целый семестр, только без сессии`,
    `«Сапсан» успел бы сгонять <b>из Москвы в Петербург</b> ${times(H / 3.75)}`,
    `Хватило бы на <b>«Игру престолов»</b> целиком ${times(H / 70)} — и на то, чтобы ещё раз разочароваться в финале`,
    H < 350 ? `Ещё <b>${num(350 - H)} ч</b> — и это был бы испанский до B1. Но ${top}, видимо, важнее` : `За это время можно было выучить <b>испанский до B1</b>. Но ${top}, видимо, важнее`,
    `<b>«Stayin' Alive»</b> ${nx((H * 60) / 4.75, "раз", "раза", "раз")} подряд. Под неё делают массаж сердца — так что ты, считай, спас целый город`,
    `Toto пели: «It's gonna take a lot to drag me away from you». <b>${hours}</b> — да, тебя не оттащить`,
    `<b>«bad guy»</b> Билли Айлиш ${nx((H * 60) / 3.23, "раз", "раза", "раз")} подряд. Duh`,
    `«You only get one shot» — у тебя их было <b>${num(plays)}</b>. Эминем бы не одобрил`,
    `У Jay-Z «99 Problems», но <b>${hours} музыки</b> — явно не одна из них`,
    `<b>«The Final Countdown»</b> ${nx((H * 60) / 5.17, "раз", "раза", "раз")} подряд. Самый долгий обратный отсчёт в истории`,
    `<b>«Hey Jude»</b> ${nx((H * 60) / 7.18, "раз", "раза", "раз")} подряд — и из них ${nx(((H * 60) / 7.18) * 4 / 60, "час", "часа", "часов")} чистого «на-на-на»`,
    `Твоё сердце за это время ударило около <b>${H * 4200 >= 1e6 ? dec1((H * 4200) / 1e6) + " млн" : num(H * 4200)} раз</b>. Надеемся, в ритм`,
    `МКС облетела бы Землю <b>${nx((H * 60) / 92, "раз", "раза", "раз")}</b>`,
    walk ? `Пешком ты прошёл бы <b>${num(km)} км</b> — дальше, чем от Москвы ${walk[0]}` : `Пешком ты прошёл бы <b>${num(km)} км</b>`,
  ];
}

const NOM: Record<string, string> = { "Хип-хоп": "хип-хоп", Поп: "поп", Рок: "рок", Электроника: "электроника", Альтернатива: "альтернатива", "R&B и соул": "R&B и соул", Саундтреки: "саундтреки", "Ню-метал": "ню-метал" };
const DEC: Record<number, string> = { 1960: "шестидесятых", 1970: "семидесятых", 1980: "восьмидесятых", 1990: "девяностых", 2000: "нулевых", 2010: "десятых", 2020: "двадцатых" };
const ORD = ["", "", "второй", "третий", "четвёртый", "пятый", "шестой", "седьмой", "восьмой", "девятый", "десятый", "одиннадцатый", "двенадцатый", "тринадцатый", "четырнадцатый", "пятнадцатый", "шестнадцатый", "семнадцатый", "восемнадцатый", "девятнадцатый", "двадцатый"];
const HOURW = ["полуночи", "часа ночи", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти", "десяти", "одиннадцати", "полудня", "часа дня", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти", "десяти", "одиннадцати"];
const ADJ: Record<string, string> = { US: "американские", GB: "британские", CA: "канадские", DE: "немецкие", FR: "французские", AU: "австралийские", SE: "шведские", RU: "русские", IT: "итальянские", NL: "нидерландские", IE: "ирландские", ES: "испанские", NG: "нигерийские", JM: "ямайские", NZ: "новозеландские", BE: "бельгийские" };

/** The listener's portrait, built from the data in plain sentences (no model on this
 *  instance yet; when one returns it can write it livelier). */
function portrait(st: St): string {
  const x = st.extra!, s: string[] = [];
  const g = x.genres.map((k) => genreRu(k.key)).filter((k, i, a) => NOM[k] && a.indexOf(k) === i);
  const d = x.decades.slice(0, 2).map((k) => k.decade).sort();
  if (g.length >= 2) s.push(`Твоя музыка — это прежде всего <b>${NOM[g[0]!]}</b> и <b>${NOM[g[1]!]}</b>${d.length === 2 && DEC[d[0]!] && DEC[d[1]!] ? ` ${DEC[d[0]!]} и ${DEC[d[1]!]}` : ""}.`);
  const fa = x.artists[0];
  if (fa) { const n = Math.round(100 / Math.max(1, fa.share)); s.push(`Чаще всех звучит <b>${fa.artist.name}</b> — ${fa.share >= 50 ? "больше половины всей музыки" : n <= 20 && ORD[n] ? `примерно каждый ${ORD[n]} час твоей музыки` : `${dec1(fa.share)} % времени`}.`); }
  const hrs = st.rhythm.byHour, h = hrs.indexOf(Math.max(...hrs));
  const part = h <= 4 ? "глубокой ночью" : h <= 10 ? "утром" : h <= 16 ? "днём" : h <= 21 ? "вечером" : "поздно вечером";
  const span = st.listening.since ? Math.max(1, Math.round((Date.now() - Date.parse(st.listening.since)) / 864e5) + 1) : st.rhythm.days.length, r = st.rhythm.days.length / span;
  s.push(`Слушаешь чаще всего ${part}, около ${HOURW[h]}${r > 0.85 ? `, и почти без перерывов: музыка была в ${st.rhythm.days.length} днях из ${span}` : r > 0.5 ? ", через день или чаще" : ""}.`);
  const c = x.countries.filter((k) => k.key !== "—"), c1 = c[0], c2 = c[1];
  if (c1 && ADJ[c1.key]) {
    const w = c1.pct >= 50 ? "больше половины времени" : c1.pct >= 40 ? "почти половина времени" : c1.pct >= 30 ? "около трети времени" : `${c1.pct} % времени`;
    s.push(`Артисты у тебя в основном <b>${ADJ[c1.key]}</b> — на них приходится ${w}${c2 && ADJ[c2.key] ? `, на втором месте ${ADJ[c2.key]}` : ""}.`);
  }
  return s.join(" ");
}

/** A mark under the pointer says its value in place (the home's week), never a tooltip. */
function useSay(out: string) {
  const [now, setNow] = useState<string | null>(null);
  return { html: now ?? out, key: now ?? "out", say: setNow, unsay: () => setNow(null) };
}
/** Charts grow in when first seen; the stagger is only for that first growth. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState<"wait" | "growing" | "in">("wait");
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { io.disconnect(); setState("growing"); setTimeout(() => setState("in"), 1600); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, attrs: { "data-wait": state === "wait" ? "" : undefined, "data-growing": state === "growing" ? "" : undefined } };
}

export function Stats() {
  const st = useQuery(statsQuery).data;
  if (!st?.extra) return <div className={css.loading}>Собираю статистику…</div>;
  return <StatsPage st={st} />;
}

function StatsPage({ st }: { st: St }) {
  const x = st.extra!;
  const favTrack = x.tracks[0];
  const fav = image(favTrack?.track.coverImageId)?.palette?.accent.light ?? "#cfd0ff";
  const H = st.listening.playedMs / 3.6e6;
  const plays = st.rhythm.days.reduce((n, d) => n + d.count, 0);
  const list = useMemo(() => phrases(H, plays, x.artists[0]?.artist.name ?? "любимый артист"), [H, plays, x.artists]);
  return (
    <div className={css.st} style={{ ["--fav" as string]: fav }}>
      <div className={css.hero}>
        <Time st={st} list={list} />
        <Days st={st} />
        <div className={css.portrait}><h3 className={css.lbl}>Портрет слушателя</h3><p dangerouslySetInnerHTML={{ __html: portrait(st) }} />
          <div className={css.src}>Собран из твоих прослушиваний. Когда вернётся модель, она перепишет его живее.</div></div>
        <Facts st={st} />
      </div>
      <div><h3 className={css.lbl}>Любимые</h3><div className={css.favs}><Fav kind="artist" st={st} /><Fav kind="track" st={st} /></div></div>
      <div><Years st={st} /><TwoCharts st={st} /></div>
      <Achievements list={x.achievements} />
    </div>
  );
}

function Time({ st, list }: { st: St; list: string[] }) {
  const H = st.listening.playedMs / 3.6e6, hh = Math.floor(H), mm = Math.round((H - hh) * 60);
  const [i, setI] = useState(() => Math.floor(Math.random() * list.length));
  const box = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null);
  const next = () => {
    const pt = box.current!;
    [...pt.children].slice(0, -1).forEach((c) => c.remove());
    const old = pt.lastElementChild as HTMLElement | null;
    const n = document.createElement("span"); n.innerHTML = list[(i + 1) % list.length]!; pt.appendChild(n);
    setI((v) => (v + 1) % list.length);
    if (reduce()) { old?.remove(); return; }
    old?.animate([{ opacity: 1, transform: "none", filter: "blur(0px)" }, { opacity: 0, transform: "translateY(-8px)", filter: "blur(5px)" }], { duration: 170, easing: "ease-in", fill: "forwards" }).finished.then(() => old.remove(), () => old.remove());
    n.animate([{ opacity: 0, transform: "translateY(10px)", filter: "blur(5px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { duration: 460, delay: 110, easing: "cubic-bezier(.2,.9,.3,1)", fill: "backwards" });
    btn.current?.querySelector("svg")?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(180deg)" }], { duration: 520, easing: "cubic-bezier(.3,1.25,.4,1)" });
  };
  // the spans of the comparison are the DOM's (they cross-fade); React only seeds the first
  useLayoutEffect(() => { if (box.current && !box.current.childElementCount) { const s = document.createElement("span"); s.innerHTML = list[i]!; box.current.appendChild(s); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={css.time}>
      <h3 className={css.lbl}>Ты слушал музыку{st.listening.since && <small>с {ru(st.listening.since)}</small>}</h3>
      <div className={css.big}>{num(hh)}<small>ч</small>{mm}<small>мин</small></div>
      <div className={css.phrase}><span ref={box} className={css.pt} /><button ref={btn} type="button" className={css.shuffle} aria-label="Другое сравнение" onClick={next}><Icon name="Shuffle" size={16} /></button></div>
    </div>
  );
}

function Days({ st }: { st: St }) {
  const days = st.rhythm.days, by = new Map(days.map((d) => [d.date, d.count]));
  const start = st.listening.since ? new Date(st.listening.since) : new Date(days[0]?.date ?? Date.now());
  start.setHours(12, 0, 0, 0);
  const cells: { d: string; c: number }[] = [];
  const today = new Date(); today.setHours(12, 0, 0, 0);
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; cells.push({ d: k, c: by.get(k) ?? 0 }); }
  const off = (start.getDay() + 6) % 7, max = Math.max(1, ...cells.map((c) => c.c));
  const out = `${days.length}<small>из ${cells.length}</small>`;
  const s = useSay(out);
  return (
    <div className={css.days}>
      <h3 className={css.lbl}>Дни с музыкой</h3>
      <div className={css.dn}><span key={s.key} className={css.say} dangerouslySetInnerHTML={{ __html: s.html }} /></div>
      <div className={css.cal} onPointerLeave={s.unsay}>
        {Array.from({ length: off }, (_, i) => <i key={"e" + i} data-empty="" />)}
        {cells.map((c, i) => (
          <i key={c.d} data-today={i === cells.length - 1 ? "" : undefined}
            style={{ background: c.c ? `color-mix(in srgb, var(--fav) ${Math.round(22 + 78 * Math.sqrt(c.c / max))}%, rgba(255,255,255,.06))` : "rgba(255,255,255,.06)" }}
            onPointerEnter={() => s.say(c.c ? `${c.c}<small>${plural(c.c, "песня", "песни", "песен")} · ${ru(c.d)}</small>` : `—<small>тишина · ${ru(c.d)}</small>`)} />
        ))}
      </div>
      <div className={css.streak}><span className={css.fire}><Icon name="Fire" size={18} /></span>
        <span><b>{st.rhythm.streakCurrent}</b> {plural(st.rhythm.streakCurrent, "день", "дня", "дней")} подряд{st.rhythm.streakCurrent >= st.rhythm.streakBest ? " — это и есть твой рекорд" : ` · рекорд ${st.rhythm.streakBest}`}</span></div>
    </div>
  );
}

function Facts({ st }: { st: St }) {
  const x = st.extra!, hrs = st.rhythm.byHour, mx = Math.max(1, ...hrs), pk = hrs.indexOf(Math.max(...hrs));
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const m = Math.round(x.avgDayMs / 6e4);
  const s = useSay(`${hh(pk)}<small>чаще всего</small>`);
  const rv = useReveal<HTMLDivElement>();
  return (
    <div ref={rv.ref} className={`${css.facts} ${css.factsGrid}`} {...rv.attrs}>
      <div className={css.fact}><span>В среднем за день</span><b>{Math.floor(m / 60)}<small>ч</small> {m % 60}<small>мин</small></b></div>
      <div className={css.fact}><span>Дослушиваешь до конца</span><b>{x.finishedPct}<small>% песен</small></b></div>
      <div className={`${css.fact} ${css.wide}`}>
        <span>Когда ты слушаешь</span>
        <b><span key={s.key} className={css.say} dangerouslySetInnerHTML={{ __html: s.html }} /></b>
        <div className={css.hours} onPointerLeave={s.unsay}>
          {hrs.map((v, h) => <i key={h} data-peak={h === pk ? "" : undefined} style={{ ["--h" as string]: (v / mx).toFixed(3), ["--n" as string]: h }}
            onPointerEnter={() => s.say(`${hh(h)}<small>${nx(v, "песня", "песни", "песен")}</small>`)} />)}
        </div>
        <div className={css.hx}><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      </div>
    </div>
  );
}

/** The top three of a kind as a stack: the first in front, the next peeking from behind; the
 *  texts lie on one another in one cell, so the arrows never move under the pointer. */
function Fav({ kind, st }: { kind: "artist" | "track"; st: St }) {
  const x = st.extra!;
  const list = kind === "artist" ? x.artists.map((a) => ({ id: a.artist.id, img: a.artist.imageId, title: a.artist.name, lines: [`<b>${dec1(a.hours)} ч</b> музыки · <b>${dec1(a.share)} %</b> всего времени`, nx(a.plays, "прослушивание", "прослушивания", "прослушиваний")] }))
    : x.tracks.map((t) => ({ id: t.track.id, img: t.track.coverImageId, title: t.track.titleDisplay ?? t.track.title, lines: [t.track.artistDisplay, `сыграна до конца <b>${nx(t.plays, "раз", "раза", "раз")}</b>`] }));
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const prev = useRef(-1);
  const deck = useRef<HTMLDivElement>(null);
  if (!list.length) return null;
  const n = list.length, go = (k: number, d: number) => { prev.current = i; setDir(d); setI(((k % n) + n) % n); };
  const play = () => {
    const front = deck.current?.querySelector<HTMLElement>("[data-pos='0'] img") ?? null;
    if (kind === "artist") void playArtist(list[i]!.id, front);
    else { const t = x.tracks[i]!.track; flyToMini(front); void player.playTracks([fromTrack(t, "search")]); }
  };
  return (
    <div className={`${css.fav} ${kind === "artist" ? css.round : ""}`}>
      <div ref={deck} className={css.deck}>
        {list.map((f, k) => (
          <div key={f.id} className={css.card2} data-pos={(k - i + n) % n} onClick={() => k !== i && go(k, k > i ? 1 : -1)}>
            <img src={imageUrl(f.img, 512) ?? undefined} alt="" />
          </div>
        ))}
        <button type="button" className={css.dplay} aria-label="Слушать" onClick={play}><Icon name="Play" size={18} /></button>
      </div>
      <div>
        <div className={css.roll}>
          {list.map((f, k) => (
            <div key={f.id} className={css.fl} data-off={k === i ? undefined : ""} aria-hidden={k !== i} style={{ ["--dy" as string]: `${k === i ? 0 : k === prev.current ? -dir * 16 : dir * 16}px` }}>
              <span className={css.k}><span className={css.rk}>№ {k + 1}</span>{kind === "artist" ? "Любимый артист" : "Любимая песня"}</span>
              <h4>{f.title}</h4>
              <div className={css.n} dangerouslySetInnerHTML={{ __html: f.lines.join("<br>") }} />
            </div>
          ))}
        </div>
        {n > 1 && (
          <div className={css.nav}>
            <button type="button" className={css.arw} aria-label="Назад" onClick={() => go(i - 1, -1)}><Icon name="ChevronLeft" size={20} /></button>
            <span className={css.dots}>{list.map((f, k) => <i key={f.id} data-on={k === i ? "" : undefined} />)}</span>
            <button type="button" className={css.arw} aria-label="Дальше" onClick={() => go(i + 1, 1)}><Icon name="ChevronRight" size={20} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The library by year: a landscape, the peak labelled; under the pointer a line and a dot run
 *  along it and the year is said above its point. */
function Years({ st }: { st: St }) {
  const x = st.extra!, col = st.collection;
  const rv = useReveal<HTMLDivElement>();
  const [hover, setHover] = useState<{ y: number; f: number; top: number } | null>(null);
  const g = useMemo(() => {
    const ys = x.years.map((y) => [y.year, y.tracks] as const);
    if (ys.length < 2) return null;
    const raw = new Map(ys);
    const y0 = Math.max(1965, Math.min(...ys.map((y) => y[0]))), y1 = Math.max(...ys.map((y) => y[0]));
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
  }, [x.years]);
  if (!g) return null;
  const core = col?.decades.reduce((a, b) => (b.count > a.count ? b : a), col.decades[0]!);
  const total = x.years.reduce((n, y) => n + y.tracks, 0);
  return (
    <div>
      <h3 className={css.lbl}>Песни по годам<small>{num(total)}</small></h3>
      <div ref={rv.ref} className={css.yr} {...rv.attrs}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.round(g.y0 + f * (g.y1 - g.y0));
          setHover({ y, f: (y - g.y0) / Math.max(1, g.y1 - g.y0), top: (g.Y(g.sm[y - g.y0] ?? 0) / 200) * (r.height - 34) }); }}
        onPointerLeave={() => setHover(null)}>
        {g.decs.map((y) => <span key={y} className={css.gl} style={{ left: `${g.X(y) / 10}%` }} />)}
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden>
          <defs><linearGradient id="yrg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--fav)" stopOpacity=".42" /><stop offset="1" stopColor="var(--fav)" stopOpacity="0" /></linearGradient></defs>
          <path d={`${g.d} L1000,200 L0,200 Z`} fill="url(#yrg)" />
          <path d={g.d} fill="none" stroke="var(--fav)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={css.pk} style={{ left: `${g.X(g.pk[0]) / 10}%`, top: (g.Y(g.sm[g.pk[0] - g.y0] ?? 0) / 200) * 196 }}>{g.pk[0]}<small>{nx(g.pk[1], "песня", "песни", "песен")}</small></div>
        {hover && <>
          <span className={css.xh} style={{ left: `${hover.f * 100}%` }} />
          <span className={css.dot} style={{ left: `${hover.f * 100}%`, top: hover.top }} />
          <span className={css.lab} style={{ left: `${Math.max(4, Math.min(96, hover.f * 100))}%`, top: hover.top }}>{hover.y}<small>{nx(g.raw.get(hover.y) ?? 0, "песня", "песни", "песен")}</small></span>
        </>}
        <div className={css.ax}>{g.decs.map((y) => <span key={y} style={{ left: `${g.X(y) / 10}%` }}>{y}</span>)}</div>
      </div>
      <p className={css.cap2}>{core && <>Ядро библиотеки — <b>{core.decade}-е</b>: {core.pct} % песен. </>}Самый богатый год — <b>{g.pk[0]}</b>.</p>
    </div>
  );
}

function Bars({ rows, nameOf, sayOf, cap, title }: { rows: { key: string; pct: number }[]; nameOf: (k: string) => React.ReactNode; sayOf: (k: string, pct: number) => string; cap: string; title: string }) {
  const s = useSay(cap);
  const mx = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <div>
      <h3 className={css.lbl}>{title}</h3>
      <div className={css.hb} onPointerLeave={s.unsay}>
        {rows.map((r, i) => (
          <div key={r.key} className={css.r} data-peak={i === 0 ? "" : undefined} onPointerEnter={() => s.say(sayOf(r.key, r.pct))}>
            <span className={css.nm}>{nameOf(r.key)}</span><span className={css.tr}><i style={{ width: `${(r.pct / mx) * 100}%`, ["--n" as string]: i }} /></span><span className={css.v}>{r.pct}%</span>
          </div>
        ))}
      </div>
      <p className={css.cap2}><span key={s.key} className={css.say} dangerouslySetInnerHTML={{ __html: s.html }} /></p>
    </div>
  );
}

function TwoCharts({ st }: { st: St }) {
  const x = st.extra!, col = st.collection;
  const rv = useReveal<HTMLDivElement>();
  const total = x.years.reduce((n, y) => n + y.tracks, 0) || 1;
  const genres = (col?.genres ?? []).map((g) => ({ key: genreRu(g.key), pct: g.pct })).filter((g, i, a) => g.key !== "Другое" && a.findIndex((b) => b.key === g.key) === i).slice(0, 6);
  const lands = x.countries.filter((c) => c.key !== "—" && countryName(c.key)).slice(0, 6);
  const H = st.listening.playedMs / 3.6e6;
  return (
    <div ref={rv.ref} className={css.two} {...rv.attrs}>
      {genres.length > 0 && <Bars title="По жанрам" rows={genres} nameOf={(k) => k} cap={`Больше всего — <b>${genres[0]!.key.toLowerCase()}</b>.`}
        sayOf={(k, p) => `<b>${k}</b> — ${nx((p / 100) * total, "песня", "песни", "песен")}, ${p} %`} />}
      {lands.length > 0 && <Bars title="Откуда твои артисты" rows={lands} cap="По времени прослушивания."
        nameOf={(k) => <>{flagUrl(k) && <span className={css.flag} style={{ backgroundImage: `url(${flagUrl(k)})` }} />}{countryName(k)}</>}
        sayOf={(k, p) => `<b>${countryName(k)}</b> — ${dec1((p / 100) * H)} ч музыки, ${p} %`} />}
    </div>
  );
}

function Achievements({ list }: { list: Ach[] }) {
  const show = useAchievementPop((s) => s.show);
  const left = (a: Ach) => {
    const n = a.target - a.value;
    if (a.unit === "ч") return `ещё ${dec1(n)} ч`;
    if (a.code === "repeat") return `ещё ${n} ${plural(n, "раз", "раза", "раз")} — и твоя`;
    return `осталось ${num(n)}`;
  };
  const earned = list.filter((a) => a.earnedOn).length;
  return (
    <div>
      <h3 className={css.lbl}>Ачивки<small>{earned} из {list.length}</small></h3>
      <div className={css.stickers}>
        {list.map((a) => {
          const on = !!a.earnedOn, near = !on && a.value / a.target >= 0.7;
          return (
            <button key={a.code} type="button" className={css.sk} data-on={on ? "" : undefined} style={{ ["--rot" as string]: `${ROT[a.code] ?? -4}deg` }}
              onClick={(e) => { if (on) show(a); else e.currentTarget.querySelector("[data-art]")?.animate([{ transform: "none" }, { transform: "rotate(-6deg)" }, { transform: "rotate(5deg)" }, { transform: "none" }], { duration: 420, easing: "ease-out" }); }}>
              <span className={css.art} data-art dangerouslySetInnerHTML={{ __html: stickerSvg(a.code, on, a.value / a.target) }} />
              <b>{a.name}</b><small>{a.line}</small>
              <span className={`${css.when} ${near ? css.near : ""}`}>{on ? `получена ${ru(a.earnedOn!)}` : `${a.unit === "ч" ? dec1(a.value) : num(a.value)} из ${num(a.target)}${a.unit ? " " + a.unit : ""} · ${left(a)}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
