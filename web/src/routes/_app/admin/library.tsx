import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api, ok, type Schemas } from "../../../api/client";
import { num } from "../../../lib/format";
import { useJob } from "../../../lib/jobs";
import css from "./admin.module.css";

export const Route = createFileRoute("/_app/admin/library")({ component: Libraries });

/** Folder grants (v1 `index_root`: a server folder indexed into one account), rescans with
 *  live progress over the WebSocket, and the rendition backlog. */
function Libraries() {
  const members = useQuery({ queryKey: ["admin", "members"], queryFn: () => ok(api.GET("/api/v2/admin/members")) });
  const ops = useQuery({ queryKey: ["admin", "ops"], queryFn: () => ok(api.GET("/api/v2/admin/ops")) }).data;
  const [queued, setQueued] = useState(false);
  return (
    <>
      <section className={css.card}>
        <div className={css.eyebrow}>Папки на сервере</div>
        <p className={css.muted}>Папка индексируется в библиотеку одного аккаунта. Пути — внутри разрешённых корней сервера.</p>
        {(members.data ?? []).map((m) => <Grant key={m.id} m={m} />)}
      </section>
      {ops && (
        <section className={css.card}>
          <div className={css.eyebrow}>Обработка файлов</div>
          <div className={css.row}>
            <span className={css.label}>
              {ops.unprocessed ? `${num(ops.unprocessed)} из ${num(ops.mediaFiles)} файлов ещё не разобраны` : "Все файлы разобраны"}
              <span className={css.hint}>Кодек, громкость и копии для мобильной сети (AAC) — без них нет нормализации и экономного качества</span>
            </span>
            <button type="button" className={css.ghost} disabled={!ops.unprocessed || queued} onClick={async () => { await ok(api.POST("/api/v2/admin/renditions/backfill")); setQueued(true); }}>{queued ? "В очереди" : "Разобрать"}</button>
          </div>
          {ops.renditions.map((r) => (
            <div key={r.tier} className={css.row}>
              <span className={css.label}>{r.tier}</span>
              <span className={css.muted}>{num(r.files)} файлов · {(r.bytes / 1024 ** 3).toFixed(1)} ГБ</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Grant({ m }: { m: Schemas["MemberOut"] }) {
  const qc = useQueryClient();
  const [path, setPath] = useState(m.indexRoot ?? "");
  const [job, setJob] = useState<string | null>(null);
  const [error, setError] = useState("");
  const p = useJob(job);
  async function save() {
    setError("");
    const r = await api.PATCH("/api/v2/admin/members/{member_id}", { params: { path: { member_id: m.id } }, body: { indexRoot: path.trim() } });
    if (!r.response.ok) return setError((r.error as { detail?: string })?.detail ?? "Не получилось");
    void qc.invalidateQueries({ queryKey: ["admin", "members"] });
  }
  async function scan() {
    setError("");
    const r = await api.POST("/api/v2/library/scan", { body: { path: m.indexRoot!, accountId: m.id } });
    if (!r.response.ok) return setError((r.error as { detail?: string })?.detail ?? "Не получилось");
    setJob(r.data!.job);
  }
  return (
    <div className={css.row}>
      <span className={css.label}>{m.displayName ?? m.email}<span className={css.hint}>{num(m.tracks)} треков</span></span>
      <form className={css.tools} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input className={css.field} value={path} onChange={(e) => setPath(e.target.value)} placeholder="/mnt/data/music/…" aria-label={`Папка для ${m.email}`} />
        <button type="submit" className={css.ghost} disabled={path.trim() === (m.indexRoot ?? "")}>{path.trim() ? "Выдать" : "Отозвать"}</button>
        <button type="button" className={css.cta} disabled={!m.indexRoot || (!!p && !p.finished)} onClick={() => void scan()}>Пересканировать</button>
      </form>
      {p && <span className={css.label}>{p.finished ? `Готово: ${num(p.total)} файлов` : `Сканирую… ${p.total ? `${num(p.done)} из ${num(p.total)}` : ""}`}<span className={css.bar} style={{ ["--p" as string]: String(p.total ? p.done / p.total : 0) }} /></span>}
      {error && <span className={css.error}>{error}</span>}
    </div>
  );
}
