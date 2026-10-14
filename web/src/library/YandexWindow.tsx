import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, ok } from "../api/client";
import { db } from "../api/db";
import { imageUrl, warmFromMirror } from "../lib/images";
import { plural } from "../lib/format";
import { useLive } from "../lib/live";
import { day, YandexMark } from "../settings/Account";
import { Icon } from "../ui/icons";
import { toast } from "../ui/toast";
import { freshQuery, linkQuery, sourcesQuery, topUp } from "./AddMusic";
import { trackSync, useInbox } from "./inbox";
import { keyOf, type Pick, type Source, topUpable, TrackPicker, tracksQuery } from "./YandexPicker";
import css from "./yandex.module.css";

/** The Yandex window (design/reference/settings, round 2): over the library, grown from «+»,
 *  the library out of focus behind it. «Уже в MusiX»: the mirrored playlists, each with what is
 *  new in Yandex (+N) and «Обновить все». «Можно перенести»: the rest, with checkboxes and
 *  «Выбрать песни»; «Перенести» makes the chosen rows travel up into the mirrored list, where
 *  they fill. Not linked yet: the code to enter on Yandex's page. */

const STD = "cubic-bezier(.22,.9,.3,1)", EMPH = "cubic-bezier(.2,.8,.2,1)";
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function YandexWindow({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const win = useRef<HTMLDivElement>(null);
  const link = useQuery(linkQuery).data;
  const linked = !!link?.linked;
  const sourcesQ = useQuery({ ...sourcesQuery, enabled: linked });
  const fresh = useQuery({ ...freshQuery, enabled: linked }).data;
  const relink = sourcesQ.error instanceof ApiError && sourcesQ.error.status === 400;
  const sources = (sourcesQ.data ?? []) as Source[];
  const sync = useInbox((s) => s.sync);
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [moving, setMoving] = useState<Set<string>>(new Set()); // chosen, travelling up, filling
  const [armed, setArmed] = useState(false);
  const freshOf = useMemo(() => new Map((fresh ?? []).map((f) => [keyOf(f.source), f.fresh])), [fresh]);
  const running = !!sync && !sync.finished;

  // the job finished: the playlists just made and the fresh counts are read again
  useEffect(() => {
    if (!sync?.finished) return;
    setMoving(new Set());
    for (const k of ["ym-sources", "ym-fresh", "ym-tracks"]) void qc.invalidateQueries({ queryKey: [k] });
  }, [sync?.finished, qc]);

  // the window grows out of «+»; its rows rise in one after another
  useLayoutEffect(() => {
    const w = win.current;
    if (!w || reduce()) return;
    w.animate([{ opacity: 0, transform: "translate(160px, -40px) scale(.72)", filter: "blur(14px)" }, { opacity: 1, offset: 0.5 }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 560, easing: EMPH });
  }, []);
  const rose = useRef(false);
  useLayoutEffect(() => {
    const w = win.current;
    if (!w || rose.current || !sources.length || reduce()) return;
    rose.current = true;
    w.querySelectorAll<HTMLElement>("[data-row], h4").forEach((r, i) => r.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 60 + i * 34, easing: STD, fill: "backwards" }));
  }, [sources.length]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  function close() {
    const w = win.current;
    if (!w || reduce()) return onClose();
    w.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(140px, -36px) scale(.7)", filter: "blur(10px)" }], { duration: 260, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = onClose;
  }

  const mirrors = sources.filter((s) => s.playlistId || moving.has(keyOf(s.source)));
  const rest = sources.filter((s) => !s.playlistId && !moving.has(keyOf(s.source)));
  const count = (s: Source) => {
    const p = picks.get(keyOf(s.source));
    if (!p) return 0;
    if (p instanceof Set) return p.size;
    const list = qc.getQueryData<{ available: boolean; state: string }[]>(["ym-tracks", keyOf(s.source)]);
    return list ? list.filter((t) => topUpable(t as never)).length : s.trackCount;
  };
  const chosen = rest.filter((s) => picks.has(keyOf(s.source)));
  const total = chosen.reduce((n, s) => n + count(s), 0);

  async function unlink() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3200); return; }
    await ok(api.DELETE("/api/v2/imports/yandex"));
    void qc.invalidateQueries({ queryKey: ["ym-link"] });
    close();
    toast("Яндекс Музыка отключена — перенесённое осталось здесь");
  }
  async function refreshAll(only?: Source) {
    const list = (only ? [only] : mirrors).filter((s) => (freshOf.get(keyOf(s.source)) ?? 0) > 0);
    if (!list.length || running) return;
    await topUp(list.map((s) => s.source), list.reduce((n, s) => n + (freshOf.get(keyOf(s.source)) ?? 0), 0));
  }

  /** «Перенести»: the rows travel up into «Уже в MusiX» and start filling there. */
  const box = useRef<HTMLDivElement>(null);
  async function move() {
    if (!chosen.length || running) return;
    let tracks: string[] | undefined;
    if (chosen.some((s) => picks.get(keyOf(s.source)) instanceof Set)) {
      tracks = [];
      for (const s of chosen) {
        const p = picks.get(keyOf(s.source))!;
        if (p instanceof Set) tracks.push(...p);
        else {
          const list = await qc.fetchQuery(tracksQuery(keyOf(s.source))).catch(() => null);
          if (!list) return toast("Яндекс не отдал список песен — попробуй ещё раз");
          tracks.push(...list.filter(topUpable).map((t) => t.id));
        }
      }
    }
    let job: string;
    try {
      job = (await ok(api.POST("/api/v2/imports/yandex/import", { body: { sources: chosen.map((s) => s.source), tracks } }))).jobId;
    } catch (e) {
      return toast(e instanceof ApiError && e.status === 409 ? "Перенос уже идёт — дождись его" : "Не получилось начать перенос");
    }
    trackSync(job, total);
    const from = new Map(chosen.map((s) => [keyOf(s.source), box.current?.querySelector(`[data-src="${keyOf(s.source)}"]`)?.getBoundingClientRect()]));
    setMoving(new Set(chosen.map((s) => keyOf(s.source))));
    setPicks(new Map());
    setOpen(null);
    requestAnimationFrame(() => {
      if (reduce()) return;
      [...from].forEach(([k, a], i) => {
        const row = box.current?.querySelector<HTMLElement>(`[data-mirror="${k}"]`);
        if (!row || !a) return;
        const b = row.getBoundingClientRect();
        row.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, opacity: 0.7 }, { transform: "none", opacity: 1 }], { duration: 640, delay: i * 60, easing: EMPH, fill: "backwards" });
      });
    });
  }

  return (
    <>
      <div className={css.scrim} onClick={close} aria-hidden />
      <div ref={win} className={css.ywin} role="dialog" aria-label="Яндекс Музыка">
        <div className={css.yhead}>
          <span className={css.yb}><YandexMark /></span>
          <div>
            <h3>Яндекс Музыка</h3>
            <p>{linked ? <>Подключена{link?.linkedAt ? ` ${day(link.linkedAt)}` : ""}{link?.login ? ` · ${link.login}` : ""} · <button type="button" data-arm={armed ? "" : undefined} onClick={() => void unlink()}>{armed ? "Точно отключить?" : "Отключить"}</button></> : "Музыка из Яндекса станет твоей библиотекой здесь"}</p>
          </div>
          <button type="button" className={css.xbtn} aria-label="Закрыть" onClick={close}><Icon name="Close" size={20} /></button>
        </div>
        {!link ? <div className={css.ybody}><Loading /></div> : !linked ? <Connect /> : (
          <>
            <div ref={box} className={css.ybody}>
              {relink && <div className={css.warn}>Яндекс больше не принимает вход — отключи аккаунт и подключи заново</div>}
              {sourcesQ.isPending ? <Loading /> : (
                <>
                  {mirrors.length > 0 && (
                    <section className={css.ysec}>
                      <h4><span>Уже в MusiX<small>следят за Яндексом: новое доливается, удалённое здесь не вернётся</small></span>
                        <button type="button" className={css.ghost} disabled={running || !mirrors.some((s) => (freshOf.get(keyOf(s.source)) ?? 0) > 0)} onClick={() => void refreshAll()}><Icon name="Refresh" size={15} /><span>Обновить все</span></button></h4>
                      {mirrors.map((s) => <MirrorRow key={keyOf(s.source)} s={s} fresh={freshOf.get(keyOf(s.source))} run={running && (moving.has(keyOf(s.source)) || (freshOf.get(keyOf(s.source)) ?? 0) > 0) ? sync : null} onOne={() => void refreshAll(s)} />)}
                    </section>
                  )}
                  {rest.length > 0 && (
                    <section className={css.ysec} style={{ marginTop: mirrors.length ? 22 : 10 }}>
                      <h4><span>Можно перенести<small>для каждого появится такой же плейлист, песни лягут и в библиотеку</small></span></h4>
                      {rest.map((s) => {
                        const k = keyOf(s.source), p = picks.get(k);
                        return (
                          <div key={k} data-row data-src={k} className={css.srcWrap} data-open={open === k ? "" : undefined}>
                            <div className={css.yrow}>
                              <button type="button" className={css.ck} role="checkbox" aria-checked={p ? (p === "all" ? true : "mixed") : false} aria-label={`Перенести «${s.title}»`}
                                onClick={() => setPicks((m) => { const n = new Map(m); if (n.has(k)) n.delete(k); else n.set(k, "all"); return n; })}>
                                <svg viewBox="0 0 20 20"><path className={css.ckAll} d="M5 10.5 8.5 14 15 6.5" /><path className={css.ckSome} d="M6 10h8" /></svg>
                              </button>
                              <Art s={s} />
                              <span className={css.ytx}><span className={css.yt}>{s.title}</span><span className={css.ys}><span className={css.mono}>{s.trackCount}</span> {plural(s.trackCount, "песня", "песни", "песен")}{p instanceof Set ? ` · выбрано ${p.size}` : ""}</span></span>
                              <button type="button" className={css.pickt} aria-expanded={open === k} onClick={() => setOpen((o) => (o === k ? null : k))}>{open === k ? "Свернуть" : "Выбрать песни"}<Icon name="ChevronDown" size={15} /></button>
                            </div>
                            <div className={css.fold} inert={open !== k}><div>
                              {open === k && <Picker k={k} pick={p} onPick={(np) => setPicks((m) => { const n = new Map(m); if (np === null || (np instanceof Set && !np.size)) n.delete(k); else n.set(k, np); return n; })} />}
                            </div></div>
                          </div>
                        );
                      })}
                    </section>
                  )}
                  {!sources.length && !relink && <p className={css.empty}>В Яндекс Музыке пока нет плейлистов</p>}
                </>
              )}
            </div>
            <div className={css.yfoot}>
              <span className={css.sum} key={`${chosen.length}.${total}`}>{running
                ? <>Переношу и доливаю · <b>{sync!.done} из {sync!.total}</b></>
                : chosen.length ? <>Выбрано <b>{chosen.length} {plural(chosen.length, "плейлист", "плейлиста", "плейлистов")}</b> · {total} {plural(total, "песня", "песни", "песен")}</> : "Отметь плейлисты, которые перенести"}</span>
              <button type="button" className={css.ctaY} disabled={!chosen.length || running} onClick={() => void move()}>Перенести</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Loading() {
  return <div className={css.loading}><span /><span /><span /></div>;
}

/** A source's picture: the mirrored playlist's own covers as a mosaic (from the mirror), else
 *  Yandex's cover; «Мне нравится» is a heart. The small Yandex mark sits on the mirrored ones. */
function Art({ s, mirrored }: { s: Source; mirrored?: boolean }) {
  const covers = useLive(async () => {
    if (!s.playlistId) return [] as string[];
    const items = await db.items.where("playlistId").equals(s.playlistId).limit(40).toArray();
    const ts = await db.tracks.bulkGet(items.map((i) => i.trackId));
    const ids = [...new Set(ts.map((t) => t?.coverImageId).filter((x): x is string => !!x))].slice(0, 4);
    await warmFromMirror(ids);
    return ids;
  }, [s.playlistId], [] as string[]) ?? [];
  const badge = mirrored ? <span className={css.yb2}><YandexMark /></span> : null;
  if (s.source === "likes") return <span className={css.likes}><span>♥</span>{badge}</span>;
  if (covers.length >= 4) return <span className={css.mos}>{covers.map((c) => <img key={c} src={imageUrl(c, 64) ?? undefined} alt="" />)}{badge}</span>;
  // no cover: a soft field in the title's own colour, like a song in the inbox before its tags
  const hue = [...s.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return <span className={css.mos1} style={s.cover ? undefined : { background: `radial-gradient(120% 90% at 20% 15%, hsl(${hue} 70% 62%), hsl(${hue + 30} 55% 26%) 70%)` }}>
    {s.cover ? <img src={s.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}{badge}</span>;
}

function MirrorRow({ s, fresh, run, onOne }: { s: Source; fresh: number | undefined; run: { done: number; total: number } | null; onOne: () => void }) {
  const state = run ? "run" : fresh == null ? "wait" : fresh ? "fresh" : "none";
  return (
    <div className={css.yrowM} data-row data-mirror={keyOf(s.source)}>
      <Art s={s} mirrored />
      <span className={css.ytx}>
        <span className={css.yt}>{s.source === "likes" ? "Мне нравится из Яндекс Музыки" : s.title}</span>
        <span className={css.ys}><span className={css.mono}>{s.trackCount}</span> {plural(s.trackCount, "песня", "песни", "песен")}{s.syncedAt ? ` · обновлён ${day(s.syncedAt)}` : " · переношу"}</span>
      </span>
      <button type="button" className={css.fresh} data-state={state} disabled={state !== "fresh"} onClick={onOne}>
        {state === "run" ? <><span className={css.spin} />{run!.done}/{run!.total}</>
          : state === "fresh" ? `+${fresh} ${plural(fresh!, "новая", "новых", "новых")}`
          : state === "none" ? <><Icon name="Check" size={13} /> свежий</> : <span className={css.spin} />}
      </button>
    </div>
  );
}

function Picker({ k, pick, onPick }: { k: string; pick: Pick | undefined; onPick: (p: Pick | null) => void }) {
  const list = useQuery({ ...tracksQuery(k) });
  const all = useMemo(() => (list.data ?? []).filter((t) => t.available && !t.imported), [list.data]);
  function setTracks(ids: string[], on: boolean) {
    const cur = pick === "all" ? new Set(all.map((t) => t.id)) : new Set(pick ?? []);
    for (const id of ids) { if (on) cur.add(id); else cur.delete(id); }
    onPick(list.data && cur.size === all.length ? "all" : cur);
  }
  if (list.isPending) return <Loading />;
  if (list.isError) return <p className={css.empty}>Яндекс не отдал список — попробуй ещё раз</p>;
  return <TrackPicker tracks={list.data ?? []} pick={pick} selectableCount={all.length} onSet={setTracks} onAll={(on) => onPick(on ? "all" : null)} />;
}

/** Not linked: a code entered on Yandex's own page (no password here); the window waits. */
function Connect() {
  const qc = useQueryClient();
  const [session, setSession] = useState<{ id: string; code: string; url: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!session) return;
    const t = setInterval(async () => {
      const s = await ok(api.GET("/api/v2/imports/yandex/auth/{session_id}", { params: { path: { session_id: session.id } } })).catch(() => null);
      if (!s) return;
      setStatus(s.status);
      if (s.status !== "pending") {
        clearInterval(t);
        setSession(null);
        void qc.invalidateQueries({ queryKey: ["ym-link"] });
      }
    }, 3000); // the device flow has no push: the code is being entered on another device
    return () => clearInterval(t);
  }, [session, qc]);
  async function start() {
    setErr("");
    const a = await ok(api.POST("/api/v2/imports/yandex/auth")).catch(() => null);
    if (!a) return setErr("Яндекс сейчас не отвечает — попробуй через минуту");
    setSession({ id: a.sessionId, code: a.userCode, url: a.verificationUrl });
    setStatus("pending");
  }
  return (
    <div className={css.connect}>
      {session ? (
        <>
          <p>Открой <a href={session.url} target="_blank" rel="noreferrer">{session.url.replace(/^https?:\/\//, "")}</a> и введи код</p>
          <div className={css.code}>{session.code.split("").map((c, i) => <span key={i} style={{ ["--i" as string]: i }}>{c}</span>)}</div>
          <small>Окно обновится само, когда код подтвердят</small>
        </>
      ) : (
        <>
          <p>Плейлисты и «Мне нравится» переедут сюда целиком, а дальше их можно будет обновлять одной кнопкой.</p>
          <small>{status && status !== "authorized" ? "Код истёк — попробуй ещё раз" : "Подключение по коду, без пароля"}</small>
          <button type="button" className={css.ctaY} onClick={() => void start()}>Подключить</button>
          {err && <span className={css.warn}>{err}</span>}
        </>
      )}
    </div>
  );
}
