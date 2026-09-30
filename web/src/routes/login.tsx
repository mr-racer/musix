import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthError, authReady, login, register } from "../api/auth";
import { instanceQuery } from "../api/queries";
import { BrandMark } from "../ui/Brand";
import { controls } from "../ui/controls";
import css from "./login.module.css";

type Search = { invite?: string; next?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    invite: typeof s.invite === "string" ? s.invite : undefined,
    next: typeof s.next === "string" && s.next.startsWith("/") ? s.next : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    if ((await authReady()) === "in") throw redirect({ to: search.next ?? "/" });
    const inst = await context.queryClient.ensureQueryData(instanceQuery);
    if (inst.setupRequired) throw redirect({ to: "/setup" });
  },
  component: Login,
});

const FEATURES = ["🖥️ Живой дизайн", "🌊 Волна под тебя", "🧞 ИИ-гуру", "🔗 Связи песен", "📊 Честная статистика", "🎧 Твои файлы"];

function Login() {
  const { invite, next } = Route.useSearch();
  const nav = useNavigate();
  const inst = useQuery(instanceQuery).data;
  const [tab, setTab] = useState<"login" | "register">(invite ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(invite ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "login") await login(email.trim(), password);
      else await register(email.trim(), password, code.trim());
      await nav({ to: next ?? "/" });
    } catch (err) {
      const status = err instanceof AuthError ? err.status : 0;
      setError(
        status === 401 ? "Неверный email или пароль"
        : status === 409 ? "Этот email уже зарегистрирован"
        : status === 403 ? "Регистрация на этом сервере закрыта"
        : status === 429 ? "Слишком много попыток — подожди минуту"
        : err instanceof AuthError && status === 400 ? "Инвайт недействителен, использован или истёк"
        : "Сервер не отвечает",
      );
    } finally {
      setBusy(false);
    }
  }

  const shared = inst?.mode !== "personal";
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
          <h1 className={css.title}>Подними свой Spotify у себя дома</h1>
          <p className={css.lede}>Бесплатно, на твоих файлах и без буллшита в рекомендациях. Не только слушай музыку — узнавай её.</p>
          <ul className={css.chips} aria-label="Что внутри">
            {FEATURES.map((f) => <li key={f} className={css.chip}>{f}</li>)}
          </ul>
        </div>
        <form className={css.card} onSubmit={submit}>
          <div className={css.eyebrow}>{shared ? "Общий сервер" : "Личный сервер"}</div>
          {shared && (
            <div className={css.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={tab === "login"} className={tab === "login" ? css.tabOn : css.tab} onClick={() => { setTab("login"); setError(""); }}>Войти</button>
              <button type="button" role="tab" aria-selected={tab === "register"} className={tab === "register" ? css.tabOn : css.tab} onClick={() => { setTab("register"); setError(""); }}>Регистрация</button>
            </div>
          )}
          <input className={css.input} type="email" required autoFocus placeholder="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="email" />
          <input className={css.input} type="password" required placeholder="пароль" autoComplete={tab === "register" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="пароль" minLength={tab === "register" ? 8 : undefined} />
          {tab === "register" && (
            <input className={css.input + " " + css.code} required placeholder="инвайт-код" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} aria-label="инвайт-код" />
          )}
          {error && <div className={controls.error} role="alert">{error}</div>}
          <button type="submit" disabled={busy} className={controls.cta + " " + css.submit}>
            {busy ? "Подождите…" : tab === "login" ? "Войти" : "Создать аккаунт"}
          </button>
          {!shared && <p className={css.note}>Здесь входят только свои: новые аккаунты создаёт владелец сервера.</p>}
        </form>
      </div>
    </div>
  );
}
