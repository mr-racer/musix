import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api, ok } from "../../../api/client";
import { num } from "../../../lib/format";
import css from "./admin.module.css";

export const Route = createFileRoute("/_app/admin/ops")({ component: Ops });

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} ГБ`;

/** A small ops page: queue depths, disk against the rendition budget, coverage. */
function Ops() {
  const o = useQuery({ queryKey: ["admin", "ops"], queryFn: () => ok(api.GET("/api/v2/admin/ops")), refetchInterval: 30_000 }).data;
  if (!o) return null;
  const queues = [...new Set(o.queues.map((q) => q.queue))];
  return (
    <>
      <div className={css.grid}>
        <Stat label="Аккаунтов" value={num(o.accounts)} />
        <Stat label="Треков" value={num(o.tracks)} />
        <Stat label="Прослушиваний за сутки" value={num(o.listensDay)} />
        <Stat label="Медиафайлов" value={num(o.mediaFiles)} />
        <Stat label="Оригиналы" value={gb(o.mediaBytes)} />
        <Stat label="Копии / бюджет" value={`${gb(o.renditionBytes)} / ${gb(o.renditionBudgetBytes)}`} bar={o.renditionBytes / Math.max(1, o.renditionBudgetBytes)} />
      </div>
      <section className={css.card}>
        <div className={css.eyebrow}>Очереди задач</div>
        {queues.length === 0 && <p className={css.muted}>Пусто — всё сделано.</p>}
        {queues.map((q) => (
          <div key={q} className={css.row}>
            <span className={css.label}>{q}</span>
            <span className={css.tools}>
              {o.queues.filter((x) => x.queue === q).map((x) => <span key={x.status} className={x.status === "failed" ? css.owner : css.pill}>{x.status}: {num(x.jobs)}</span>)}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}

function Stat({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className={css.stat}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
      {bar !== undefined && <span className={css.bar} style={{ ["--p" as string]: String(Math.min(1, bar)) }} />}
    </div>
  );
}
