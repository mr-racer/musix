import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../../../api/auth";
import { api } from "../../../api/client";
import css from "./admin.module.css";

export const Route = createFileRoute("/_app/admin/setup")({ component: Setup });

/** v1 `SetupWizard`, steps 2–3 (the owner exists now): the LLM, then a music folder. Both
 *  can be skipped and done later in the admin. */
function Setup() {
  const nav = useNavigate();
  const me = useAuth((s) => s.accountId);
  const [step, setStep] = useState<2 | 3>(2);
  const [llm, setLlm] = useState({ baseUrl: "", model: "", apiKey: "" });
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  async function saveLlm() {
    setError("");
    if (llm.baseUrl) {
      const r = await api.PUT("/api/v2/admin/llm", { body: { baseUrl: llm.baseUrl, model: llm.model || null, ...(llm.apiKey ? { apiKey: llm.apiKey } : {}) } });
      if (!r.response.ok) return setError("Не сохранилось — проверь адрес");
    }
    setStep(3);
  }
  async function saveFolder() {
    setError("");
    if (path.trim() && me) {
      const g = await api.PATCH("/api/v2/admin/members/{member_id}", { params: { path: { member_id: me } }, body: { indexRoot: path.trim() } });
      if (!g.response.ok) return setError((g.error as { detail?: string })?.detail ?? "Папка вне разрешённых корней сервера");
      await api.POST("/api/v2/library/scan", { body: { path: path.trim() } });
    }
    await nav({ to: "/admin" });
  }

  return (
    <section className={css.card}>
      <div className={css.eyebrow}>Первый запуск · шаг {step} из 3</div>
      {step === 2 ? (
        <form className={css.form} onSubmit={(e) => { e.preventDefault(); void saveLlm(); }}>
          <p className={css.muted}>ИИ пишет факты, биографии и отвечает в ассистенте. Нужен любой OpenAI-совместимый сервер — например, llama.cpp у тебя дома.</p>
          <input className={css.field} placeholder="http://192.168.0.10:8082/v1" value={llm.baseUrl} onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })} aria-label="Адрес LLM" />
          <input className={css.field} placeholder="модель" value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })} aria-label="Модель" />
          <input className={css.field} type="password" autoComplete="off" placeholder="API-ключ (если нужен)" value={llm.apiKey} onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })} aria-label="API-ключ" />
          <div className={css.tools}>
            <button type="submit" className={css.cta}>{llm.baseUrl ? "Дальше" : "Пропустить"}</button>
            {error && <span className={css.error}>{error}</span>}
          </div>
        </form>
      ) : (
        <form className={css.form} onSubmit={(e) => { e.preventDefault(); void saveFolder(); }}>
          <p className={css.muted}>Папка с музыкой на этом сервере станет твоей библиотекой. Друзьям папки выдаются в «Библиотеках», или они загружают свою музыку сами.</p>
          <input className={css.field} placeholder="/mnt/data/music" value={path} onChange={(e) => setPath(e.target.value)} aria-label="Папка с музыкой" />
          <div className={css.tools}>
            <button type="submit" className={css.cta}>{path.trim() ? "Сканировать и готово" : "Пропустить"}</button>
            {error && <span className={css.error}>{error}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
