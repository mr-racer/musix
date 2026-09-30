import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ok } from "../../api/client";
import { plural } from "../../lib/format";
import { useJob } from "../../lib/jobs";
import { controls } from "../../ui/controls";
import css from "./settings.module.css";

export const Route = createFileRoute("/_app/import")({ component: Import });

/** The Yandex Music import (v1's, per account): link by device code, pick the likes and
 *  playlists, import; progress arrives over the WebSocket. */
function Import() {
  const qc = useQueryClient();
  const link = useQuery({ queryKey: ["ym-link"], queryFn: () => ok(api.GET("/api/v2/imports/yandex")) }).data;
  const [session, setSession] = useState<{ id: string; code: string; url: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const job = useJob(jobId);
  const sources = useQuery({ queryKey: ["ym-sources"], enabled: !!link?.linked, queryFn: () => ok(api.GET("/api/v2/imports/yandex/sources")) }).data ?? [];

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
    setError("");
    const a = await ok(api.POST("/api/v2/imports/yandex/auth")).catch(() => null);
    if (!a) return setError("Яндекс сейчас не отвечает");
    setSession({ id: a.sessionId, code: a.userCode, url: a.verificationUrl });
    setStatus("pending");
  }

  async function run() {
    setError("");
    const chosen = [...picked].map((i) => (sources[i] as { source: unknown }).source);
    const r = await ok(api.POST("/api/v2/imports/yandex/import", { body: { sources: chosen } })).catch(() => null);
    if (!r) return setError("Не получилось запустить импорт");
    setJobId(r.jobId);
  }

  return (
    <div className={css.page}>
      <h1 className={css.title}>Импорт из Яндекс Музыки</h1>
      <section className={css.card}>
        <div className={css.eyebrow}>Аккаунт Яндекса</div>
        {link?.linked ? (
          <div className={css.row}>
            <span className={css.label}>Подключён {link.login && <b>{link.login}</b>}</span>
            <button type="button" className={css.revoke} onClick={async () => { await ok(api.DELETE("/api/v2/imports/yandex")); void qc.invalidateQueries({ queryKey: ["ym-link"] }); }}>Отключить</button>
          </div>
        ) : session ? (
          <div className={css.row}>
            <span className={css.label}>
              Открой <a className={css.link} href={session.url} target="_blank" rel="noreferrer">{session.url.replace(/^https?:\/\//, "")}</a> и введи код
              <span className={css.hint}>Страница обновится сама, когда код подтвердят</span>
            </span>
            <span className={css.code}>{session.code}</span>
          </div>
        ) : (
          <div className={css.row}>
            <span className={css.label}>Музыка из Яндекса станет твоей библиотекой здесь<span className={css.hint}>{status && status !== "authorized" ? "Код истёк — попробуй ещё раз" : "Подключение по коду, без пароля"}</span></span>
            <button type="button" className={controls.cta} onClick={() => void start()}>Подключить</button>
          </div>
        )}
      </section>
      {link?.linked && (
        <section className={css.card}>
          <div className={css.eyebrow}>Что импортировать</div>
          {sources.map((s, i) => (
            <label key={i} className={css.row}>
              <span className={css.label}>{s.title}<span className={css.hint}>{s.trackCount} {plural(s.trackCount, "трек", "трека", "треков")}</span></span>
              <input type="checkbox" checked={picked.has(i)} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(i) : n.delete(i); return n; })} />
            </label>
          ))}
          <div className={css.row}>
            <span className={css.label}>{job ? (job.finished ? "Готово — треки уже в библиотеке" : `Импортирую… ${job.total ? `${job.done} из ${job.total}` : ""}`) : ""}</span>
            <button type="button" className={controls.cta} disabled={!picked.size || (!!job && !job.finished)} onClick={() => void run()}>Импортировать</button>
          </div>
        </section>
      )}
      {error && <div className={controls.error}>{error}</div>}
    </div>
  );
}
