import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ok } from "../../api/client";
import { clock, plural } from "../../lib/format";
import { useJob } from "../../lib/jobs";
import { controls } from "../../ui/controls";
import { Icon } from "../../ui/icons";
import css from "./import.module.css";
import base from "./settings.module.css";

export const Route = createFileRoute("/_app/import")({ component: Import });

type Source = { source: unknown; title: string; trackCount: number; cover?: string | null };
type YTrack = { id: string; title: string; artists: string[]; album?: string | null; durationMs?: number | null; cover?: string | null; available: boolean; imported: boolean };
/** What is picked in one source: the whole source, or some of its tracks. */
type Pick = "all" | Set<string>;

const ROW = 56;
const keyOf = (src: unknown) => (src === "likes" ? "likes" : String((src as { kind: number }).kind));
const selectable = (t: YTrack) => t.available && !t.imported;
const tracksQuery = (key: string) => ({
  queryKey: ["ym-tracks", key],
  queryFn: () => ok(api.GET("/api/v2/imports/yandex/tracks", { params: { query: { source: key } } })) as Promise<YTrack[]>,
  staleTime: 5 * 60_000,
});

/** The Yandex Music import (v1's, per account): link by device code, pick whole sources or
 *  single tracks inside them, import; progress arrives over the WebSocket. */
function Import() {
  const qc = useQueryClient();
  const link = useQuery({ queryKey: ["ym-link"], queryFn: () => ok(api.GET("/api/v2/imports/yandex")) }).data;
  const [session, setSession] = useState<{ id: string; code: string; url: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const job = useJob(jobId);
  const sources = (useQuery({ queryKey: ["ym-sources"], enabled: !!link?.linked, queryFn: () => ok(api.GET("/api/v2/imports/yandex/sources")) }).data ?? []) as Source[];

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

  useEffect(() => {
    if (job?.finished) void qc.invalidateQueries({ queryKey: ["ym-tracks"] }); // fresh «уже здесь» marks
  }, [job?.finished, qc]);

  async function start() {
    setError("");
    const a = await ok(api.POST("/api/v2/imports/yandex/auth")).catch(() => null);
    if (!a) return setError("Яндекс сейчас не отвечает");
    setSession({ id: a.sessionId, code: a.userCode, url: a.verificationUrl });
    setStatus("pending");
  }

  function setPick(key: string, p: Pick | null) {
    setPicks((m) => {
      const n = new Map(m);
      if (p === null || (p instanceof Set && p.size === 0)) n.delete(key);
      else n.set(key, p);
      return n;
    });
  }

  const count = (s: Source) => {
    const p = picks.get(keyOf(s.source));
    if (!p) return 0;
    if (p instanceof Set) return p.size;
    const list = qc.getQueryData<YTrack[]>(["ym-tracks", keyOf(s.source)]);
    return list ? list.filter(selectable).length : s.trackCount;
  };
  const total = sources.reduce((n, s) => n + count(s), 0);

  async function run() {
    setError("");
    const chosen = sources.filter((s) => picks.has(keyOf(s.source)));
    let tracks: string[] | undefined;
    if (chosen.some((s) => picks.get(keyOf(s.source)) instanceof Set)) {
      // some sources are partial: name every track, the whole ones included
      tracks = [];
      for (const s of chosen) {
        const p = picks.get(keyOf(s.source))!;
        if (p instanceof Set) tracks.push(...p);
        else {
          const list = await qc.fetchQuery(tracksQuery(keyOf(s.source))).catch(() => null);
          if (!list) return setError("Яндекс не отдал список треков — попробуй ещё раз");
          tracks.push(...list.filter(selectable).map((t) => t.id));
        }
      }
    }
    const r = await ok(api.POST("/api/v2/imports/yandex/import", { body: { sources: chosen.map((s) => s.source), tracks } })).catch(() => null);
    if (!r) return setError("Не получилось запустить импорт");
    setJobId(r.jobId);
    setPicks(new Map());
    setOpen(null);
  }

  const running = !!job && !job.finished;
  return (
    <div className={base.page}>
      <h1 className={base.title}>Импорт из Яндекс Музыки</h1>
      <section className={base.card}>
        <div className={base.eyebrow}>Аккаунт Яндекса</div>
        {link?.linked ? (
          <div className={base.row}>
            <span className={base.label}>Подключён {link.login && <b>{link.login}</b>}</span>
            <button type="button" className={base.revoke} onClick={async () => { await ok(api.DELETE("/api/v2/imports/yandex")); void qc.invalidateQueries({ queryKey: ["ym-link"] }); }}>Отключить</button>
          </div>
        ) : session ? (
          <div className={base.row}>
            <span className={base.label}>
              Открой <a className={base.link} href={session.url} target="_blank" rel="noreferrer">{session.url.replace(/^https?:\/\//, "")}</a> и введи код
              <span className={base.hint}>Страница обновится сама, когда код подтвердят</span>
            </span>
            <span className={base.code}>{session.code}</span>
          </div>
        ) : (
          <div className={base.row}>
            <span className={base.label}>Музыка из Яндекса станет твоей библиотекой здесь<span className={base.hint}>{status && status !== "authorized" ? "Код истёк — попробуй ещё раз" : "Подключение по коду, без пароля"}</span></span>
            <button type="button" className={controls.cta} onClick={() => void start()}>Подключить</button>
          </div>
        )}
      </section>
      {link?.linked && (
        <section className={base.card}>
          <div className={base.eyebrow}>Что импортировать</div>
          <p className={css.lead}>Отметь плейлист целиком или раскрой его и выбери треки. То, что уже здесь, повторно не качается.</p>
          <ul className={css.sources}>
            {sources.map((s) => {
              const key = keyOf(s.source);
              return (
                <SourceRow key={key} source={s} pick={picks.get(key)} count={count(s)} open={open === key}
                  onToggleOpen={() => setOpen((o) => (o === key ? null : key))}
                  onPick={(p) => setPick(key, p)} />
              );
            })}
          </ul>
          <div className={css.footer}>
            <span className={css.status}>
              {job ? (
                <>
                  <span>{job.finished ? "Готово — треки уже в библиотеке" : `Импортирую… ${job.total ? `${job.done} из ${job.total}` : ""}`}</span>
                  <span className={css.bar}><span style={{ transform: `scaleX(${job.finished ? 1 : job.total ? job.done / job.total : 0.02})` }} /></span>
                </>
              ) : total ? (
                <span key={total} className={css.tick}>Выбрано {total} {plural(total, "трек", "трека", "треков")}</span>
              ) : null}
            </span>
            <button type="button" className={controls.cta} disabled={!picks.size || running} onClick={() => void run()}>
              Импортировать
            </button>
          </div>
        </section>
      )}
      {error && <div className={controls.error}>{error}</div>}
    </div>
  );
}

function SourceRow({ source, pick, count, open, onToggleOpen, onPick }: {
  source: Source;
  pick: Pick | undefined;
  count: number;
  open: boolean;
  onToggleOpen: () => void;
  onPick: (p: Pick | null) => void;
}) {
  const key = keyOf(source.source);
  const list = useQuery({ ...tracksQuery(key), enabled: open });
  const all = useMemo(() => (list.data ?? []).filter(selectable), [list.data]);
  const state: "none" | "some" | "all" = !pick ? "none" : pick === "all" || (list.data && pick.size >= all.length) ? "all" : "some";

  /** Turn `ids` on or off inside this source's pick (one row, or the rows a search found). */
  function setTracks(ids: string[], on: boolean) {
    const cur = pick === "all" ? new Set(all.map((t) => t.id)) : new Set(pick ?? []);
    for (const id of ids) {
      if (on) cur.add(id);
      else cur.delete(id);
    }
    onPick(list.data && cur.size === all.length ? "all" : cur);
  }

  return (
    <li className={open ? css.sourceOpen : css.source}>
      <div className={css.head}>
        <Check state={state} label={`Импортировать «${source.title}» целиком`} onChange={() => onPick(state === "none" ? "all" : null)} />
        <button type="button" className={css.headMain} onClick={onToggleOpen} aria-expanded={open}>
          {source.cover ? (
            <img className={css.art} src={source.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className={css.artLikes} aria-hidden="true">♥</span>
          )}
          <span className={css.headText}>
            <span className={css.headTitle}>{source.title}</span>
            <span className={css.headSub}>
              {source.trackCount} {plural(source.trackCount, "трек", "трека", "треков")}
              {state !== "none" && <>{" · "}<span key={count} className={css.picked}>выбрано {count}</span></>}
            </span>
          </span>
          <span className={css.pickHint}>{open ? "Свернуть" : "Выбрать треки"}</span>
          <span className={css.chevron}><Icon name="ChevronDown" size={18} /></span>
        </button>
      </div>
      <div className={css.fold} inert={!open}>
        <div className={css.foldInner}>
          {open && (
            list.isPending ? (
              <div className={css.loading}><span /><span /><span /></div>
            ) : list.isError ? (
              <div className={css.empty}>Яндекс не отдал список — попробуй ещё раз</div>
            ) : (
              <TrackPicker tracks={list.data ?? []} pick={pick} selectableCount={all.length}
                onSet={setTracks} onAll={(on) => onPick(on ? "all" : null)} />
            )
          )}
        </div>
      </div>
    </li>
  );
}

function TrackPicker({ tracks, pick, selectableCount, onSet, onAll }: {
  tracks: YTrack[];
  pick: Pick | undefined;
  selectableCount: number;
  onSet: (ids: string[], on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const [q, setQ] = useState("");
  // rows rise in only as the list opens: the virtualizer mounts rows while scrolling too
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 700);
    return () => clearTimeout(t);
  }, []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? tracks.filter((t) => `${t.title} ${t.artists.join(" ")} ${t.album ?? ""}`.toLowerCase().includes(needle)) : tracks;
  }, [tracks, q]);
  const box = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => box.current, estimateSize: () => ROW, overscan: 10 });
  const isOn = (t: YTrack) => selectable(t) && (pick === "all" || (pick instanceof Set && pick.has(t.id)));
  // while searching, the button acts on what was found, not on the whole source
  const searching = q.trim() !== "";
  const found = searching ? shown.filter(selectable) : [];
  const allOn = searching
    ? found.length > 0 && found.every(isOn)
    : selectableCount > 0 && (pick === "all" ? selectableCount : pick?.size ?? 0) >= selectableCount;

  return (
    <div className={css.picker}>
      <div className={css.tools}>
        <label className={css.search}>
          <Icon name="Search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в плейлисте" aria-label="Найти в плейлисте" />
        </label>
        <button type="button" className={css.allBtn} disabled={searching ? !found.length : !selectableCount}
          onClick={() => (searching ? onSet(found.map((t) => t.id), !allOn) : onAll(!allOn))}>
          {searching ? (allOn ? "Снять найденные" : "Выбрать найденные") : allOn ? "Снять все" : "Выбрать все"}
        </button>
      </div>
      <div ref={box} className={css.list} data-fresh={fresh || undefined} style={{ height: Math.min(shown.length * ROW, 8 * ROW) || ROW }}>
        {!shown.length && <div className={css.empty}>Ничего не нашлось</div>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((r) => {
            const t = shown[r.index]!;
            const on = isOn(t);
            const can = selectable(t);
            return (
              <button key={t.id} type="button" disabled={!can} onClick={() => onSet([t.id], !on)}
                className={on ? css.trackOn : can ? css.track : css.trackOff}
                style={{ top: r.start, ["--i" as string]: Math.min(r.index, 12) }}>
                <span className={css.trackCheck}><Check state={on ? "all" : "none"} passive /></span>
                {t.cover ? <img className={css.cover} src={t.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className={css.cover} />}
                <span className={css.text}>
                  <span className={css.trackTitle}>{t.title}</span>
                  <span className={css.trackSub}>{[t.artists.join(", "), t.album].filter(Boolean).join(" · ")}</span>
                </span>
                {t.imported ? <span className={css.tag}>уже здесь</span> : !t.available ? <span className={css.tagOff}>недоступен</span> : null}
                <span className={css.time}>{t.durationMs ? clock(t.durationMs) : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A checkbox with a mark that draws itself and a box that answers the press. `passive`:
 *  drawn inside a row that is itself the button. */
function Check({ state, label, onChange, passive }: { state: "none" | "some" | "all"; label?: string; onChange?: () => void; passive?: boolean }) {
  const mark = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path className={css.markAll} d="M5 10.5 8.5 14 15 6.5" />
      <path className={css.markSome} d="M6 10h8" />
    </svg>
  );
  if (passive) return <span className={css.check} data-state={state}>{mark}</span>;
  return (
    <button type="button" role="checkbox" aria-checked={state === "all" ? true : state === "some" ? "mixed" : false} aria-label={label}
      className={css.check} data-state={state} onClick={onChange}>
      {mark}
    </button>
  );
}
