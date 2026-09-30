import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ok, type Schemas } from "../../../api/client";
import { instanceQuery } from "../../../api/queries";
import css from "./admin.module.css";

export const Route = createFileRoute("/_app/admin/instance")({ component: Instance });

function Instance() {
  const qc = useQueryClient();
  const inst = useQuery(instanceQuery).data;
  const cfg = useQuery({ queryKey: ["admin", "instance"], queryFn: () => ok(api.GET("/api/v2/admin/instance")) }).data;
  const [form, setForm] = useState<Schemas["InstanceSettings"] | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (cfg) setForm(cfg); }, [cfg]);
  if (!form) return null;
  return (
    <section className={css.card}>
      <div className={css.eyebrow}>Сервер</div>
      <form onSubmit={async (e) => { e.preventDefault(); await ok(api.PUT("/api/v2/admin/instance", { body: form })); setSaved(true); void qc.invalidateQueries({ queryKey: ["admin", "instance"] }); void qc.invalidateQueries({ queryKey: ["instance"] }); }}>
        <label className={css.row}>
          <span className={css.label}>Название<span className={css.hint}>Видно на экране входа и во вкладке</span></span>
          <input className={css.field} value={form.name ?? ""} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className={css.row}>
          <span className={css.label}>Регистрация<span className={css.hint}>По инвайту — друзья приходят по ссылке; закрыта — новые аккаунты не создаются</span></span>
          <select className={css.field} value={form.registration ?? "invite"} onChange={(e) => setForm({ ...form, registration: e.target.value as "invite" | "closed" })}>
            <option value="invite">по инвайту</option>
            <option value="closed">закрыта</option>
          </select>
        </label>
        <div className={css.row}>
          <span className={css.label}>Режим<span className={css.hint}>Задаётся при первом запуске</span></span>
          <span className={css.muted}>{inst?.mode === "personal" ? "личный" : "общий"}</span>
        </div>
        <div className={css.tools}><button type="submit" className={css.cta}>Сохранить</button>{saved && <span className={css.ok}>Сохранено</span>}</div>
      </form>
    </section>
  );
}
