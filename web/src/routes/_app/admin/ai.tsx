import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ok } from "../../../api/client";
import { instanceQuery } from "../../../api/queries";
import css from "./admin.module.css";

export const Route = createFileRoute("/_app/admin/ai")({ component: Ai });

const STATUS: Record<string, string> = { up: "отвечает", down: "не отвечает", unauthorized: "ключ не подошёл", unconfigured: "не настроен", unknown: "проверяется" };

/** The AI policy (v1's toggle: AI for members) and the one LLM endpoint of the server. The
 *  key is write-only: the page only learns whether one is stored. */
function Ai() {
  const qc = useQueryClient();
  const inst = useQuery(instanceQuery).data;
  const cfg = useQuery({ queryKey: ["admin", "instance"], queryFn: () => ok(api.GET("/api/v2/admin/instance")) }).data;
  const llm = useQuery({ queryKey: ["admin", "llm"], queryFn: () => ok(api.GET("/api/v2/admin/llm")) }).data;
  const [form, setForm] = useState({ baseUrl: "", model: "", apiKey: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (llm) setForm({ baseUrl: llm.baseUrl ?? "", model: llm.model ?? "", apiKey: "" }); }, [llm]);

  async function policy(on: boolean) {
    if (!cfg) return;
    await ok(api.PUT("/api/v2/admin/instance", { body: { ...cfg, aiForMembers: on } }));
    void qc.invalidateQueries({ queryKey: ["admin", "instance"] });
    void qc.invalidateQueries({ queryKey: ["instance"] });
  }
  async function save() {
    setSaved(false);
    await ok(api.PUT("/api/v2/admin/llm", { body: { baseUrl: form.baseUrl || null, model: form.model || null, ...(form.apiKey ? { apiKey: form.apiKey } : {}) } }));
    setSaved(true);
    void qc.invalidateQueries({ queryKey: ["admin", "llm"] });
  }
  return (
    <>
      <section className={css.card}>
        <div className={css.eyebrow}>Политика</div>
        <label className={css.row}>
          <span className={css.label}>ИИ для участников<span className={css.hint}>Ассистент и чат о песне в приложениях. У владельца ИИ есть всегда</span></span>
          <span className={css.switch}><input type="checkbox" checked={cfg?.aiForMembers ?? true} disabled={!cfg} onChange={(e) => void policy(e.target.checked)} /><span /></span>
        </label>
      </section>
      <section className={css.card}>
        <div className={css.eyebrow}>Языковая модель</div>
        <p className={css.muted}>Любой OpenAI-совместимый сервер. Сейчас: {STATUS[inst?.llm ?? "unknown"] ?? inst?.llm}</p>
        <form className={css.form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className={css.field} placeholder="http://192.168.0.10:8082/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} aria-label="Адрес" />
          <input className={css.field} placeholder="модель" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} aria-label="Модель" />
          <input className={css.field} type="password" autoComplete="off" placeholder={llm?.hasKey ? "ключ сохранён — оставь пустым" : "API-ключ (если нужен)"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} aria-label="API-ключ" />
          <div className={css.tools}>
            <button type="submit" className={css.cta}>Сохранить</button>
            {saved && <span className={css.ok}>Сохранено — сервер проверит связь в течение минуты</span>}
          </div>
        </form>
      </section>
    </>
  );
}
