import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthError, setup } from "../api/auth";
import { setSetting } from "../api/settings";
import { type Place, PlacePicker } from "../ui/PlacePicker";
import { instanceQuery } from "../api/queries";
import { BrandMark } from "../ui/Brand";
import { controls } from "../ui/controls";
import css from "./login.module.css";

/** First run (v1 `SetupWizard`, step 1): the owner account and the mode. The rest of the
 *  wizard (the LLM, the music folder) continues in the admin once signed in. */
export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const inst = await context.queryClient.fetchQuery(instanceQuery);
    if (!inst.setupRequired) throw redirect({ to: "/login" });
  },
  component: Setup,
});

function Setup() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"personal" | "shared">("shared");
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await setup(email.trim(), password, mode);
      if (place) await setSetting(["weather", "place"], place); // the home's sky; nothing chosen means Istanbul
      await nav({ to: "/admin/setup" });
    } catch (err) {
      setError(err instanceof AuthError && err.status === 409 ? "Сервер уже настроен" : err instanceof AuthError ? err.detail : "Сервер не отвечает");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={css.screen}>
      <div className={css.auroraA} />
      <div className={css.auroraB} />
      <div className={css.wrap}>
        <div className={css.hero}>
          <div className={css.brand}>
            <BrandMark size={46} />
            <span className={css.brandName}>MUSIX</span>
          </div>
          <h1 className={css.title}>Первый запуск</h1>
          <p className={css.lede}>Создай аккаунт владельца. Потом подключим ИИ и папку с музыкой — это можно сделать и позже, в админке.</p>
        </div>
        <form className={css.card} onSubmit={submit}>
          <div className={css.eyebrow}>Шаг 1 из 3 · владелец</div>
          <input className={css.input} type="email" required autoFocus placeholder="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="email" />
          <input className={css.input} type="password" required minLength={8} placeholder="пароль (от 8 символов)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="пароль" />
          <div className={css.tabs} role="radiogroup" aria-label="Режим">
            <button type="button" role="radio" aria-checked={mode === "shared"} className={mode === "shared" ? css.tabOn : css.tab} onClick={() => setMode("shared")}>Общий — для друзей</button>
            <button type="button" role="radio" aria-checked={mode === "personal"} className={mode === "personal" ? css.tabOn : css.tab} onClick={() => setMode("personal")}>Личный</button>
          </div>
          <div className={css.field}>
            <span className={css.fieldLabel}>Город для погоды на главной <small>необязательно; без выбора — Стамбул</small></span>
            <PlacePicker value={place} onChange={setPlace} />
          </div>
          {error && <div className={controls.error} role="alert">{error}</div>}
          <button type="submit" disabled={busy} className={controls.cta + " " + css.submit}>{busy ? "Создаю…" : "Создать сервер"}</button>
        </form>
      </div>
    </div>
  );
}
