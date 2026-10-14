import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, ok } from "../api/client";
import { db, rowToTrack, type TrackRow } from "../api/db";
import { imageUrl, warmFromMirror } from "../lib/images";
import { plural } from "../lib/format";
import { useLive } from "../lib/live";
import { fromTrack, player } from "../player/engine";
import { YandexMark } from "../settings/Account";
import { Icon } from "../ui/icons";
import glass from "../ui/glass.module.css";
import { toast } from "../ui/toast";
import { addFiles, cancel, clearDone, retry, ringOf, seen, trackSync, useInbox, type Row } from "./inbox";
import css from "./add.module.css";

/** «Добавить» beside the library's search (design/reference/settings, round 2): one place for
 *  all music coming in. The ring around «+» is the progress of everything arriving; the badge
 *  counts songs that became playable since the menu was last opened. The menu: the inbox (one
 *  row per song), Яндекс Музыка (the window over the library), «Обновить из Яндекса» (+N into
 *  every mirrored playlist), С компьютера. Files dragged onto the page: the wall goes out of
 *  focus, an open sleeve waits; dropped, it flies into «+». */

const SPRING = "cubic-bezier(.34,1.56,.64,1)", STD = "cubic-bezier(.22,.9,.3,1)";
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const linkQuery = queryOptions({ queryKey: ["ym-link"], queryFn: () => ok(api.GET("/api/v2/imports/yandex")) });
export const sourcesQuery = queryOptions({ queryKey: ["ym-sources"], queryFn: () => ok(api.GET("/api/v2/imports/yandex/sources")), staleTime: 5 * 60_000 });
export const freshQuery = queryOptions({ queryKey: ["ym-fresh"], queryFn: () => ok(api.GET("/api/v2/imports/yandex/fresh")), staleTime: 5 * 60_000 });

/** «Обновить из Яндекса»: every mirrored playlist takes what is new in Yandex (and what failed
 *  last time); its progress shares the ring. */
export async function topUp(sources: unknown[], total: number): Promise<boolean> {
  try {
    const r = await ok(api.POST("/api/v2/imports/yandex/import", { body: { sources } }));
    trackSync(r.jobId, total);
    return true;
  } catch (e) {
    toast(e instanceof ApiError && e.status === 409 ? "Обновление уже идёт" : "Яндекс не ответил — попробуй ещё раз");
    return false;
  }
}

export function AddMusic({ onYandex, drop, startOpen }: { onYandex: () => void; drop: boolean; startOpen?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(!!startOpen);
  const st = useInbox();
  const ring = ringOf(st);
  const link = useQuery(linkQuery).data;
  // the «+N» is asked once the menu has been opened (one Yandex call per mirrored playlist)
  const [askFresh, setAskFresh] = useState(!!startOpen);
  const fresh = useQuery({ ...freshQuery, enabled: askFresh && !!link?.linked }).data;
  const freshN = (fresh ?? []).reduce((a, f) => a + f.fresh, 0);

  // «+» takes in what arrived
  const gulped = useRef(st.gulp);
  useEffect(() => {
    if (st.gulp === gulped.current) return;
    gulped.current = st.gulp;
    if (!reduce()) btn.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)", offset: 0.3 }, { transform: "scale(.94)", offset: 0.6 }, { transform: "scale(1)" }], { duration: 600, easing: SPRING });
  }, [st.gulp]);

  useLayoutEffect(() => {
    const m = menu.current;
    if (!open || !m) return;
    if (!reduce()) {
      m.animate([{ opacity: 0, transform: "scale(.82)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 420, easing: SPRING });
      [...m.children].forEach((b, i) => b.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: 40 + i * 30, easing: STD, fill: "backwards" }));
    }
    const off = (e: PointerEvent) => { if (!m.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", off); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", off); window.removeEventListener("keydown", esc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  function close() {
    const m = menu.current;
    if (!m || reduce()) return setOpen(false);
    m.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.86)", filter: "blur(4px)" }], { duration: 190, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => setOpen(false);
  }
  useEffect(() => { if (drop && open) close(); }, [drop]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = st.sync && !st.sync.finished ? st.sync : null;
  async function runSync() {
    const srcs = (fresh ?? []).filter((f) => f.fresh > 0).map((f) => f.source);
    if (!srcs.length) return;
    await topUp(srcs, freshN);
  }

  return (
    <>
      <button ref={btn} type="button" className={`${css.addb} ${glass.lg}`} aria-label="Добавить музыку" aria-haspopup="menu" aria-expanded={open}
        data-busy={ring.busy ? "" : undefined} data-new={st.added > 0 ? "" : undefined} style={{ ["--p" as string]: ring.p }}
        onClick={() => { if (open) return close(); setOpen(true); setAskFresh(true); seen(); }}>
        <Icon name="Plus" size={20} />
        <svg className={css.ring} viewBox="0 0 52 52" aria-hidden><circle className={css.tr} cx="26" cy="26" r="24" /><circle className={css.pr} cx="26" cy="26" r="24" /></svg>
        <span className={css.cnt}>+{st.added}</span>
      </button>
      <input ref={input} type="file" multiple hidden accept="audio/*,.flac,.m4a,.alac,.ape,.wv,.opus"
        onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) addFiles(fs); }} />
      {open && (
        <div ref={menu} className={`${css.amenu} ${glass.lg}`} role="menu" data-wide={st.rows.some((r) => !r.gone) ? "" : undefined}>
          <div className={css.cap}>Добавить музыку</div>
          <Inbox rows={st.rows} />
          <button type="button" className={css.mi} role="menuitem" onClick={() => { close(); setTimeout(onYandex, 120); }}>
            <span className={css.micY}><YandexMark /></span>
            <span><span className={css.mt}>Из Яндекс Музыки</span><span className={css.ms}>{link?.linked ? <>Подключена{fresh ? ` · ${fresh.length} ${plural(fresh.length, "плейлист", "плейлиста", "плейлистов")} уже здесь` : ""}</> : "Подключить по коду, без пароля"}</span></span>
            <span className={css.chev}><Icon name="ChevronRight" size={18} /></span>
          </button>
          {link?.linked && (fresh?.length ?? 0) > 0 && (
            <button type="button" className={css.miSync} role="menuitem" disabled={!!sync || !freshN} onClick={() => void runSync()}>
              <span className={css.mic}><Icon name="Refresh" size={20} /></span>
              <span><span className={css.mt}>{sync ? "Обновляю из Яндекса" : "Обновить из Яндекса"}</span>
                <span className={css.ms}>{sync ? `${sync.done} из ${sync.total} новых песен` : freshN ? `Долить новое в ${fresh!.length} ${plural(fresh!.length, "плейлист", "плейлиста", "плейлистов")}` : "Всё свежее — новых песен нет"}</span></span>
              {sync ? <span className={css.new}>{sync.total ? Math.round((sync.done / sync.total) * 100) : 0}%</span> : freshN ? <span className={css.new}>+{freshN}</span> : null}
            </button>
          )}
          <hr />
          <button type="button" className={css.miUpl} role="menuitem" onClick={() => { close(); input.current?.click(); }}>
            <span className={css.mic}><Icon name="Upload" size={20} /></span>
            <span><span className={css.mt}>С компьютера</span><span className={css.ms}>Файлы или целая папка. Можно просто перетащить их на страницу</span></span>
            <span className={css.chev}><Icon name="ChevronRight" size={18} /></span>
          </button>
        </div>
      )}
    </>
  );
}

const STAGE: Record<Row["phase"], number> = { queue: 0, hash: 0, send: 0, sound: 1, facts: 2, done: 3, dupe: 3, error: -1 };
function label(r: Row): string {
  switch (r.phase) {
    case "queue": return "В очереди";
    case "hash": return `Проверяю файл · ${Math.round(r.p * 100)}%`;
    case "send": return `Отправляю · ${Math.round(r.p * 100)}%${r.speed ? ` · ${r.speed.toFixed(1).replace(".", ",")} МБ/с` : ""}`;
    case "sound": return "Обрабатываю звук";
    case "facts": return "Собираю факты";
    case "done": return r.facts ? `Готово · ${r.facts} ${plural(r.facts, "факт", "факта", "фактов")}` : "Готово";
    case "dupe": return "Уже в библиотеке";
    case "error": return r.err ?? "Не получилось";
  }
}

/** The inbox: rows built once and updated in place (nothing jumps); the title, artist and cover
 *  appear when the server has read the tags; the list scrolls under soft edges with the app's
 *  thin bar. */
function Inbox({ rows }: { rows: Row[] }) {
  const live = rows.filter((r) => !r.gone);
  const ids = live.map((r) => r.trackId).filter((x): x is string => !!x);
  const tracks = useLive(async () => {
    const got = (await db.tracks.bulkGet(ids)).filter((t): t is TrackRow => !!t);
    await warmFromMirror(got.map((t) => t.coverImageId));
    return new Map(got.map((t) => [t.id, t]));
  }, [ids.join(",")], new Map<string, TrackRow>());
  const list = useRef<HTMLOListElement>(null), wrap = useRef<HTMLDivElement>(null);
  const edges = () => {
    const ol = list.current, w = wrap.current;
    if (!ol || !w) return;
    w.toggleAttribute("data-top", ol.scrollTop > 2);
    w.toggleAttribute("data-bottom", ol.scrollTop + ol.clientHeight < ol.scrollHeight - 2);
  };
  useLayoutEffect(edges);
  if (!live.length) return null;
  const fin = live.filter((r) => ["facts", "done", "dupe", "error"].includes(r.phase)).length;
  const ready = live.filter((r) => ["facts", "done", "dupe"].includes(r.phase)).length;
  return (
    <div className={css.inbox}>
      <div className={css.ih}>
        <span className={css.ihT}>{fin === live.length
          ? <>Загружено <span>{ready} из {live.length} в библиотеке</span></>
          : <>Загружаю {live.length} {plural(live.length, "песню", "песни", "песен")} <span>{ready} уже {plural(ready, "играет", "играют", "играют")}</span></>}</span>
        {live.some((r) => r.phase === "done" || r.phase === "dupe") && <button type="button" className={css.ihClear} onClick={clearDone}>Убрать готовые</button>}
      </div>
      <div ref={wrap} className={css.ibWrap}>
        <ol ref={list} onScroll={edges}>
          {rows.map((r) => <InRow key={r.key} r={r} t={r.trackId ? tracks?.get(r.trackId) : undefined} />)}
        </ol>
      </div>
    </div>
  );
}

function InRow({ r, t }: { r: Row; t: TrackRow | undefined }) {
  const li = useRef<HTMLLIElement>(null), cv = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(!r.gone);
  // a row that goes folds away
  useLayoutEffect(() => {
    const el = li.current;
    if (!r.gone || !el) return;
    if (reduce()) return setShown(false);
    el.animate([{ opacity: 1, height: `${el.offsetHeight}px` }, { opacity: 0, height: "0px", paddingTop: "0px", paddingBottom: "0px", filter: "blur(4px)" }], { duration: 320, easing: STD, fill: "forwards" }).onfinish = () => setShown(false);
  }, [r.gone]);
  // the cover develops once the tags are read
  const cover = t ? imageUrl(t.coverImageId, 96) : null;
  const known = !!t;
  useLayoutEffect(() => {
    if (known && !reduce()) cv.current?.animate([{ filter: "blur(6px) saturate(.3)", opacity: 0.4 }, { filter: "none", opacity: 1 }], { duration: 700, easing: STD });
  }, [known]);
  const act = ["facts", "done", "dupe"].includes(r.phase) && (t || r.trackId) ? "play" : r.phase === "error" ? "retry" : ["queue", "hash", "send"].includes(r.phase) ? "cancel" : "";
  const actEl = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (act === "play" && !reduce()) actEl.current?.firstElementChild?.animate([{ transform: "scale(0)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 480, easing: SPRING });
  }, [act]);
  if (!shown) return null;
  const stg = STAGE[r.phase];
  const fill = (k: number) => r.phase === "error" ? (k <= (r.failedAt ?? 0) ? 1 : 0)
    : k < stg ? 1 : k === stg && k === 0 ? (r.phase === "hash" ? 0.08 * r.p : r.phase === "send" ? 0.08 + 0.92 * r.p : 0) : 0;
  async function play() {
    const row = t ?? (r.trackId ? await db.tracks.get(r.trackId) : undefined);
    if (row) await player.playTracks([fromTrack(rowToTrack(row), "queue")]);
  }
  return (
    <li ref={li} data-phase={r.phase}>
      <span ref={cv} className={css.cv} style={{ ["--h" as string]: r.hue, backgroundImage: cover ? `url(${cover})` : undefined }} data-dev={known ? "" : undefined} data-fill={known && !cover ? "" : undefined}>
        <span className={css.fmt}>{(r.name.split(".").pop() ?? "").toUpperCase()}</span>
      </span>
      <span className={css.tx}>
        <span className={css.ti}>{t ? t.title : r.name.replace(/\.[^.]+$/, "")}</span>
        <span className={css.ar}>{t ? [t.artist, t.album].filter(Boolean).join(" · ") : r.phase === "error" || r.phase === "dupe" ? "" : "теги прочитаются на сервере"}</span>
      </span>
      <span ref={actEl} className={css.act} data-a={act}>
        {act === "play" && <button type="button" aria-label="Слушать" onClick={() => void play()}><Icon name="Play" size={13} /></button>}
        {act === "retry" && <button type="button" aria-label="Повторить" onClick={() => retry(r.key)}><Icon name="Retry" size={15} /></button>}
        {act === "cancel" && <button type="button" aria-label="Отменить" onClick={() => cancel(r.key)}><Icon name="Close" size={14} /></button>}
      </span>
      <span className={css.st}>
        <span className={css.segs}>{[0, 1, 2].map((k) => (
          <i key={k} style={{ ["--p" as string]: fill(k) }} data-wave={r.phase !== "error" && k === stg && k > 0 ? "" : undefined} data-bad={r.phase === "error" && k === (r.failedAt ?? 0) ? "" : undefined} />
        ))}</span>
        <span className={css.lb}>{label(r)}</span>
      </span>
    </li>
  );
}

/** Files dragged over the page: the wall goes out of focus, an open sleeve waits; dropped, the
 *  sleeve flies into «+» and is taken in. */
export function useDrop(enabled: boolean): [boolean, React.RefObject<HTMLDivElement | null>] {
  const [over, setOver] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const has = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; setOver(true); };
    const overE = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!has(e)) return; if (--depth <= 0) { depth = 0; setOver(false); } };
    const dropE = async (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      const list = await filesOf(e.dataTransfer!);
      const d = panel.current, plus = document.querySelector("[aria-label='Добавить музыку']");
      if (d && plus && !reduce()) {
        const a = d.getBoundingClientRect(), b = plus.getBoundingClientRect();
        const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
        d.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.35}px, ${dy * 0.55}px) scale(.55)`, opacity: 0.9, offset: 0.45 }, { transform: `translate(${dx}px, ${dy}px) scale(.06)`, opacity: 0 }],
          { duration: 640, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" }).onfinish = () => { setOver(false); useInbox.setState((s) => ({ gulp: s.gulp + 1 })); };
      } else setOver(false);
      const n = addFiles(list);
      if (!n) toast("Здесь нет музыки — FLAC, ALAC, MP3, AAC, Opus или WAV");
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", overE);
    window.addEventListener("dragleave", leave); window.addEventListener("drop", dropE);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", overE); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", dropE); };
  }, [enabled]);
  return [over, panel];
}

/** A dropped folder counts too: its files, all the way down. */
async function filesOf(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  if (!entries.some((e) => e.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    else if (e.isDirectory) {
      const r = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => r.readEntries(res, rej));
        if (!batch.length) break;
        for (const x of batch) await walk(x);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

export function DropPanel({ panel }: { panel: React.RefObject<HTMLDivElement | null> }) {
  useLayoutEffect(() => {
    if (!reduce()) panel.current?.animate([{ opacity: 0, transform: "scale(.88)", filter: "blur(10px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 460, easing: SPRING });
  }, [panel]);
  return (
    <div ref={panel} className={`${css.drop} ${glass.lg}`}>
      <div className={css.sleeve}><span className={css.rec} /><span className={css.env} /></div>
      <h4>Отпусти — и песни лягут в библиотеку</h4>
      <p>FLAC, ALAC, MP3, AAC, Opus, WAV · до 2 ГБ на файл.<br />Папку можно целиком. Одинаковые файлы не загрузятся дважды.</p>
    </div>
  );
}

