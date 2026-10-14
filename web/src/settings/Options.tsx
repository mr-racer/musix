import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ok, type Schemas } from "../api/client";
import { incognitoUntil, setSetting, type Settings } from "../api/settings";
import { bulk } from "../library/film";
import { Icon, type IconName } from "../ui/icons";
import glass from "../ui/glass.module.css";
import { day } from "./Account";
import css from "./settings.module.css";

/** The options under the account, as tabs (the owner chose them over two columns, 2026-10-14):
 *  Звук → Главная → Приватность → Устройства → Клавиши. Between tabs what leaves goes out of
 *  focus to its side and what comes arrives into focus a beat later, the underline glides —
 *  the library's tabs in small. */

export type Tab = "sound" | "home" | "privacy" | "devices" | "keys";
export const TABS: [Tab, string][] = [["sound", "Звук"], ["home", "Главная"], ["privacy", "Приватность"], ["devices", "Устройства"], ["keys", "Клавиши"]];
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMPH = "cubic-bezier(.2,.8,.2,1)", STD = "cubic-bezier(.22,.9,.3,1)", SPRING = "cubic-bezier(.34,1.56,.64,1)";

export function Options({ s, tab, setTab, devices }: { s: Settings; tab: Tab; setTab: (t: Tab) => void; devices: Schemas["DeviceOut"][] | undefined }) {
  const tabs = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const place = (still = false) => {
    const b = tabs.current?.querySelector<HTMLElement>("[aria-pressed='true']"), ul = tabs.current?.querySelector<HTMLElement>("[data-ul]");
    if (!b || !ul) return;
    const first = still || !placed.current;
    if (first) ul.style.transition = "none";
    ul.style.setProperty("--x", `${b.offsetLeft}px`); ul.style.setProperty("--w", `${b.offsetWidth}px`);
    if (first) { void ul.offsetWidth; ul.style.transition = ""; placed.current = true; }
  };
  useLayoutEffect(() => place(), [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // the words change width when the font arrives or the window is resized: the line follows still
  useEffect(() => {
    const again = () => place(true);
    void document.fonts?.ready.then(again);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const order = TABS.map((t) => t[0]);
  function go(t: Tab) {
    if (t === tab) return;
    const dir = Math.sign(order.indexOf(t) - order.indexOf(tab)), old = body.current?.firstElementChild as HTMLElement | null;
    if (reduce() || !old) return setTab(t);
    old.animate([{ opacity: 1, filter: "blur(0)", transform: "none" }, { opacity: 0, filter: "blur(8px)", transform: `translateX(${-dir * 18}px)` }], { duration: 180, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => {
      flushSync(() => setTab(t));
      (body.current?.firstElementChild as HTMLElement | null)?.animate(
        [{ opacity: 0, filter: "blur(8px)", transform: `translateX(${dir * 30}px)` }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 520, easing: EMPH });
    };
    // the underline leaves at once, with the press
    const b = tabs.current?.querySelector<HTMLElement>(`[data-t="${t}"]`), ul = tabs.current?.querySelector<HTMLElement>("[data-ul]");
    if (b && ul) { ul.style.setProperty("--x", `${b.offsetLeft}px`); ul.style.setProperty("--w", `${b.offsetWidth}px`); }
  }
  return (
    <>
      <nav ref={tabs} className={css.stabs} aria-label="Разделы настроек">
        {TABS.map(([k, n]) => <button key={k} type="button" data-t={k} aria-pressed={k === tab} onClick={() => go(k)}>{n}</button>)}
        <span className={css.sul} data-ul />
      </nav>
      <div ref={body} className={css.opts}>
        {tab === "sound" && <Sound s={s} />}
        {tab === "home" && <Home s={s} />}
        {tab === "privacy" && <Privacy s={s} />}
        {tab === "devices" && <Devices list={devices} />}
        {tab === "keys" && <Keys />}
      </div>
    </>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" className={css.sw} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function Row({ label, hint, children, extra, wide }: { label: string; hint: string; children?: React.ReactNode; extra?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? css.rowWide : css.row}>
      <div className={css.lbl}>{label}<span className={css.hint}>{hint}</span>{extra}</div>
      {children && <div className={css.ctl}>{children}</div>}
    </div>
  );
}

const LUFS = [92, 38, 70, 24, 100, 55, 80];
function Sound({ s }: { s: Settings }) {
  const norm = s.playback?.normalize ?? true, auto = s.playback?.autoplay ?? true, ach = s.sound?.achievements ?? true;
  return (
    <section className={css.sec}>
      <h2>Звук</h2>
      <Row label="Выравнивать громкость" hint="Тихие и громкие записи звучат на одном уровне. Альбом выравнивается целиком — тихое интро остаётся тихим."
        extra={<div className={css.lufs} data-on={norm ? "" : undefined}>{LUFS.map((h, k) => <i key={k} style={{ ["--h" as string]: h, ["--k" as string]: k }} />)}<span>−14 LUFS</span></div>}>
        <Switch on={norm} label="Выравнивать громкость" onChange={(v) => void setSetting(["playback", "normalize"], v)} />
      </Row>
      <Row label="Автоплейлист" hint="Когда плейлист или альбом закончился, музыка не замолкает: дальше сами играют похожие песни.">
        <Switch on={auto} label="Автоплейлист" onChange={(v) => void setSetting(["playback", "autoplay"], v)} />
      </Row>
      <Row label="Звук ачивок" hint="Тихий «бульк», когда приходит новая ачивка.">
        <Switch on={ach} label="Звук ачивок" onChange={(v) => { void setSetting(["sound", "achievements"], v); if (v) bulk(); }} />
      </Row>
    </section>
  );
}

function Home({ s }: { s: Settings }) {
  const precip = s.home?.precip ?? true;
  return (
    <section className={css.sec}>
      <h2>Главная</h2>
      <Row wide label="Город для неба" hint="Небо на главной повторяет время суток и погоду в этом городе. Без выбора — Стамбул. По IP не определяем: с VPN это был бы чужой город."
        extra={<City place={s.weather?.place ?? null} />} />
      <Row label="Снег и дождь" hint="Осадки падают на главную и ложатся на её блоки. Выключи — останется только цвет неба.">
        <Switch on={precip} label="Снег и дождь" onChange={(v) => void setSetting(["home", "precip"], v)} />
      </Row>
    </section>
  );
}

type Place = NonNullable<NonNullable<Settings["weather"]>["place"]>;
const ISTANBUL: Place = { name: "Стамбул", country: "Турция", lat: 41.01, lon: 28.98, timezone: "Europe/Istanbul" };
/** The city's hour: by its zone when the geocoder named one, else by its longitude. */
function localHour(p: Place): [number, number] {
  if (p.timezone) {
    try {
      const [h, m] = new Intl.DateTimeFormat("ru-RU", { timeZone: p.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
      return [h! % 24, m!];
    } catch { /* an unknown zone: the longitude below */ }
  }
  const d = new Date(Date.now() + Math.round(p.lon / 15) * 3_600_000);
  return [d.getUTCHours(), d.getUTCMinutes()];
}
const SKIES = { // the home's palettes, by the hour
  night: { bg: "radial-gradient(80% 90% at 75% 10%, #26305e 0%, transparent 60%), linear-gradient(180deg, #0b1026 0%, #141a3a 60%, #1d1838 100%)", orb: "#e9e6d6", glow: "0 0 18px 4px rgba(233,230,214,.35)", stars: 1, name: "ночь" },
  morning: { bg: "radial-gradient(90% 80% at 25% 100%, #ffb38a 0%, transparent 60%), linear-gradient(180deg, #6fa7e6 0%, #c6b9e6 60%, #ffc3a3 100%)", orb: "#fff4cf", glow: "0 0 26px 8px rgba(255,230,160,.6)", stars: 0, name: "утро" },
  day: { bg: "radial-gradient(70% 70% at 70% 0%, #bfe1ff 0%, transparent 60%), linear-gradient(180deg, #3d86e0 0%, #6aa9ef 60%, #a9cdf5 100%)", orb: "#fffbe8", glow: "0 0 26px 10px rgba(255,250,220,.7)", stars: 0, name: "день" },
  evening: { bg: "radial-gradient(90% 90% at 30% 100%, #ff7a45 0%, transparent 62%), linear-gradient(180deg, #33306e 0%, #8a4a86 55%, #f08a5d 100%)", orb: "#ffd08a", glow: "0 0 24px 8px rgba(255,170,90,.55)", stars: 0.4, name: "вечер" },
};

/** The city field (the server's geocoding, a glass list under it) and a small window of that
 *  city's sky at its local hour; a new city dims the window and lights it again. */
function City({ place }: { place: Place | null }) {
  const qc = useQueryClient();
  const p = place ?? ISTANBUL;
  const [q, setQ] = useState(p.name), [focus, setFocus] = useState(false);
  const [hits, setHits] = useState<Schemas["PlaceOut"][]>([]), [hl, setHl] = useState(0);
  const [, tick] = useState(0);
  const field = useRef<HTMLLabelElement>(null), list = useRef<HTMLDivElement>(null), skyL = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!focus) setQ(p.name); }, [p.name, focus]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const words = q.trim();
    if (!focus || words.length < 2 || words === p.name) { setHits([]); return; }
    let dead = false;
    const t = setTimeout(async () => {
      try { const got = await ok(api.GET("/api/v2/weather/places", { params: { query: { q: words } } })); if (!dead) { setHits(got.slice(0, 6)); setHl(0); } } catch { if (!dead) setHits([]); }
    }, 260);
    return () => { dead = true; clearTimeout(t); };
  }, [q, focus, p.name]);
  const open = focus && hits.length > 0;
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    const l = list.current;
    if (open && !wasOpen.current && l && !reduce()) {
      l.animate([{ opacity: 0, transform: "scale(.9) translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: SPRING });
      [...l.children].forEach((b, i) => b.animate([{ opacity: 0, transform: "translateY(-5px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 30 + i * 28, easing: STD, fill: "backwards" }));
    }
    wasOpen.current = open;
  }, [open]);
  function pick(h: Schemas["PlaceOut"]) {
    void setSetting(["weather", "place"], { name: h.name, country: h.country, admin: h.admin, lat: h.lat, lon: h.lon, timezone: h.timezone });
    void qc.invalidateQueries({ queryKey: ["home"] });
    setHits([]); setQ(h.name);
    field.current?.querySelector("input")?.blur();
    if (!reduce()) skyL.current?.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 900, easing: STD });
  }
  const [h, m] = localHour(p);
  const part = h < 5 || h >= 22 ? "night" : h < 10 ? "morning" : h < 17 ? "day" : "evening";
  const sky = SKIES[part], f = ((h + m / 60) % 24) / 24;
  return (
    <div className={css.city}>
      <label ref={field} className={css.field}>
        <Icon name="Search" size={16} />
        <input value={q} placeholder="Начни вводить город" autoComplete="off" aria-label="Город"
          onFocus={(e) => { setFocus(true); e.currentTarget.select(); }} onBlur={() => setTimeout(() => setFocus(false), 120)} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setHits([]); e.currentTarget.blur(); }
            if (!hits.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setHl((x) => (x + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length); }
            if (e.key === "Enter") { e.preventDefault(); pick(hits[hl]!); }
          }} />
        {open && (
          <div ref={list} className={`${css.places} ${glass.lg}`}>
            {hits.map((x, i) => (
              <button key={`${x.lat},${x.lon}`} type="button" data-hl={i === hl ? "" : undefined} onMouseDown={(e) => { e.preventDefault(); pick(x); }}>
                {x.name}<small>{[x.admin, x.country].filter(Boolean).join(", ")}</small>
              </button>
            ))}
          </div>
        )}
      </label>
      <div className={css.sky} aria-hidden>
        <div ref={skyL} className={css.skyL} style={{ background: sky.bg }} />
        <div className={css.stars} style={{ opacity: sky.stars }} />
        <div className={css.orb} style={{ background: sky.orb, boxShadow: sky.glow, transform: `translate(${18 + f * 110}px, ${18 + Math.abs(Math.sin(f * Math.PI * 2)) * 16}px)` }} />
        <div className={css.skyCap}><span>{p.name}</span><small>{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")} · {sky.name}</small></div>
      </div>
    </div>
  );
}

function Privacy({ s }: { s: Settings }) {
  const until = incognitoUntil(s);
  function set(on: boolean) {
    const now = new Date();
    void setSetting(["privacy", "incognito"], on
      ? { from: now.toISOString(), until: new Date(now.getTime() + 6 * 3_600_000).toISOString() }
      : s.privacy?.incognito ? { from: s.privacy.incognito.from, until: now.toISOString() } : null);
  }
  return (
    <section className={css.sec}>
      <h2>Приватность</h2>
      <Row label="Слушать инкогнито" hint="Пока включено, песни не попадают в статистику, ачивки и «Поток» — для вечеринки или чужого плейлиста. Выключится само через 6 часов.">
        <Switch on={until != null} label="Слушать инкогнито" onChange={set} />
      </Row>
    </section>
  );
}

/** The devices: the live ones, and older sign-ins of the same device folded under «Старые
 *  входы» (the server makes a new device on every sign-in, so a phone reinstalled twice shows
 *  three times). Revoking asks twice, like deleting a playlist. */
const PLAT: Record<string, [IconName, string]> = { web: ["Browser", "Браузер"], android: ["Phone", "Android"], windows: ["Monitor", "Windows"] };
const seen = (iso: string) => {
  const d = new Date(iso), now = new Date(), hm = d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  if (now.getTime() - d.getTime() < 5 * 60_000) return "сейчас";
  if (d.toDateString() === now.toDateString()) return `был сегодня в ${hm}`;
  if (d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return `был вчера в ${hm}`;
  return `был ${day(iso)}`;
};
function Devices({ list }: { list: Schemas["DeviceOut"][] | undefined }) {
  const qc = useQueryClient();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [openOld, setOpenOld] = useState(false);
  const all = (list ?? []).filter((d) => !gone.has(d.id)).sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  const live: Schemas["DeviceOut"][] = [], old: [Schemas["DeviceOut"], string][] = [];
  const keys = new Set<string>();
  for (const d of all) {
    const key = `${d.platform}|${d.name}`;
    if (d.name === "legacy-v1") old.push([d, `вход из старой MusiX · ${day(d.lastSeenAt)}`]);
    else if (!d.current && keys.has(key)) old.push([d, `${d.platform === "android" ? "до переустановки" : "прошлый вход"} · ${day(d.lastSeenAt)}`]);
    else { keys.add(key); live.push(d); }
  }
  async function revoke(id: string) {
    setGone((g) => new Set(g).add(id));
    await ok(api.DELETE("/api/v2/devices/{device_id}", { params: { path: { device_id: id } } })).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["devices"] });
  }
  return (
    <section className={css.sec}>
      <h2>Устройства</h2>
      {live.map((d, k) => <Dev key={d.id} d={d} k={k} sub={d.current ? "сейчас" : seen(d.lastSeenAt)} onRevoke={revoke} />)}
      {old.length > 0 && (
        <div className={css.old} data-open={openOld ? "" : undefined}>
          <button type="button" onClick={() => setOpenOld((v) => !v)}><Icon name="ChevronDown" size={16} /><span>Старые входы · {old.length}</span></button>
          <div className={css.fold}><div inert={!openOld}>
            {old.map(([d, sub], k) => <Dev key={d.id} d={d} k={k} sub={sub} onRevoke={revoke} />)}
            <button type="button" className={css.cleanall} onClick={() => old.forEach(([d], i) => setTimeout(() => void revoke(d.id), i * 90))}>Отключить все старые</button>
          </div></div>
        </div>
      )}
    </section>
  );
}

function Dev({ d, k, sub, onRevoke }: { d: Schemas["DeviceOut"]; k: number; sub: string; onRevoke: (id: string) => void }) {
  const [glyph, pn] = PLAT[d.platform] ?? (["Devices", d.platform] as [IconName, string]);
  const [armed, setArmed] = useState(false);
  const row = useRef<HTMLDivElement>(null), t = useRef(0);
  function click() {
    if (!armed) { setArmed(true); clearTimeout(t.current); t.current = window.setTimeout(() => setArmed(false), 3200); return; }
    const r = row.current;
    if (!r || reduce()) return onRevoke(d.id);
    r.style.height = `${r.offsetHeight}px`;
    r.classList.add(css.goneRow!);
    r.addEventListener("animationend", () => onRevoke(d.id), { once: true });
  }
  return (
    <div ref={row} className={css.dev} style={{ ["--k" as string]: k }}>
      <span className={css.glyph}><Icon name={glyph} size={20} />{d.current && <i className={css.onDot} />}</span>
      <span>
        <span className={css.nm}>{d.name}{d.current && <em>это устройство</em>}</span>
        <span className={css.sub2}>{pn}{d.appVersion ? <> · <span className={css.mono}>{d.appVersion}</span></> : null} · {sub}</span>
      </span>
      {d.current ? <span /> : <button type="button" className={css.revoke} data-arm={armed ? "" : undefined} onClick={click}>{armed ? "Точно отключить?" : "Отключить"}</button>}
    </div>
  );
}

function Keys() {
  const K: [string, string][] = [["Space", "пауза и продолжить"], ["← →", "перемотка на 10 секунд"], ["Shift ← →", "предыдущая и следующая"], ["/", "поиск"], ["L", "огонёк песне"], ["Q", "очередь"]];
  return (
    <section className={css.sec}>
      <h2>Горячие клавиши</h2>
      <div className={css.keys}>{K.map(([k, v]) => [<kbd key={k}>{k}</kbd>, <span key={`${k}.`}>{v}</span>])}</div>
    </section>
  );
}
