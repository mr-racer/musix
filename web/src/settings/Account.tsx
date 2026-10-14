import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { logout, refresh, useAuth } from "../api/auth";
import { api, ApiError, ok, type Schemas } from "../api/client";
import { Icon } from "../ui/icons";
import glass from "../ui/glass.module.css";
import { toast } from "../ui/toast";
import css from "./settings.module.css";

/** The account under the banner (the owner, round 2: «название акка + яндекс музыку + пароль и
 *  экспорт данных повесим вверх страницы»): who you are and the way out, then what is tied to
 *  the account. */

const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const day = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`; };
const IMPULSE = "M1.06,9.65L1.09,9.30L10.74,8.91L3.82,4.44L4.00,4.17L11.16,6.76L8.21,1.54L8.46,1.40L13.46,6.00L13.77,1.00L14.04,1.01L15.62,6.35L18.07,2.67L18.28,2.80L17.24,7.16L21.00,5.28L21.14,5.49L18.41,8.67L22.68,9.01L22.73,9.27L18.70,10.34L22.94,13.06L22.88,13.32L18.46,12.11L21.68,17.32L21.49,17.55L17.42,14.03L18.55,20.79L18.27,20.93L15.17,14.30L11.58,23.00L11.24,22.94L13.12,12.79L3.10,18.72L2.89,18.43L11.91,10.94Z";
export const YandexMark = () => <svg viewBox="0 0 24 24" aria-hidden><path d={IMPULSE} /></svg>;

export function Account({ me }: { me: Schemas["MeOut"] | undefined }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const link = useQuery({ queryKey: ["ym-link"], queryFn: () => ok(api.GET("/api/v2/imports/yandex")) }).data;
  const [armed, setArmed] = useState(false);
  const [pw, setPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const since = me?.listeningSince ?? me?.createdAt;

  async function unlink() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3200); return; }
    await ok(api.DELETE("/api/v2/imports/yandex"));
    setArmed(false);
    void qc.invalidateQueries({ queryKey: ["ym-link"] });
    toast("Яндекс Музыка отключена — перенесённое осталось здесь");
  }
  async function exportData() {
    setBusy(true);
    try {
      const get = () => fetch("/api/v2/me/export", { headers: { authorization: `Bearer ${useAuth.getState().access}` } });
      let r = await get();
      if (r.status === 401 && (await refresh())) r = await get();
      if (!r.ok) throw new Error(String(r.status));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = `musix-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch {
      toast("Не получилось собрать архив — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={css.acct}>
      <div className={css.me}>
        <span className={css.ava}>{(me?.email ?? "·").slice(0, 1).toUpperCase()}</span>
        <span className={css.meT}>
          <b>{me?.email ?? " "}</b>
          <span>{me ? `${me.role === "owner" ? "Владелец" : "Участник"}${since ? ` · слушает здесь с ${day(since)}` : ""}` : " "}</span>
        </span>
        <button type="button" className={css.signout} onClick={async () => { await logout(); void nav({ to: "/login" }); }}>
          <svg className={css.door} viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path className={css.leaf} d="M6 4.5 13 3v18l-7-1.5z" /></svg>
          Выйти
        </button>
      </div>
      <div className={css.links}>
        <div className={css.cell}>
          <span className={css.ciY}><YandexMark /></span>
          <span className={css.ct}><b>Яндекс Музыка</b><span>{link?.linked ? `подключена${link.linkedAt ? ` ${day(link.linkedAt)}` : ""}` : "не подключена"}</span></span>
          {link?.linked
            ? <button type="button" className={css.lnk} data-arm={armed ? "" : undefined} onClick={() => void unlink()}>{armed ? "Точно отключить?" : "Отключить"}</button>
            : <button type="button" className={css.lnk} onClick={() => void nav({ to: "/library", search: { add: "yandex" } })}>Подключить</button>}
        </div>
        <div className={css.cell}>
          <span className={css.ci}><Icon name="Key" size={18} /></span>
          <span className={css.ct}><b>Пароль</b><span>другие устройства выйдут сами</span></span>
          <button type="button" className={css.lnk} aria-expanded={pw} onClick={() => setPw((v) => !v)}>Сменить</button>
          {pw && <Password onClose={() => setPw(false)} />}
        </div>
        <div className={css.cell}>
          <span className={css.ci}><Icon name="Download" size={18} /></span>
          <span className={css.ct}><b>Мои данные</b><span>история и плейлисты · CSV и M3U</span></span>
          <button type="button" className={css.lnk} disabled={busy} onClick={() => void exportData()}>{busy ? "Собираю…" : "Скачать"}</button>
        </div>
      </div>
    </section>
  );
}

/** A small glass card that grows out of «Сменить»: the current password, a new one. */
function Password({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const box = useRef<HTMLFormElement>(null);
  const [cur, setCur] = useState(""), [next, setNext] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    const m = box.current;
    if (!m) return;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      m.animate([{ opacity: 0, transform: "scale(.9) translateY(-6px)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
    }
    m.querySelector("input")?.focus({ preventScroll: true });
    const off = (e: PointerEvent) => { if (!m.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[aria-expanded]")) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", off); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", off); window.removeEventListener("keydown", esc); };
  }, [onClose]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setErr("Новый пароль — от 8 символов");
    setBusy(true); setErr("");
    try {
      await ok(api.POST("/api/v2/auth/password", { body: { current: cur, new: next } }));
      void qc.invalidateQueries({ queryKey: ["devices"] });
      onClose();
      toast("Пароль сменён — другие устройства вышли");
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 403 ? "Текущий пароль не тот" : "Не получилось — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={box} className={`${css.pwcard} ${glass.lg}`} onSubmit={(e) => void submit(e)}>
      <label className={css.field}><input type="password" autoComplete="current-password" placeholder="Текущий пароль" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className={css.field}><input type="password" autoComplete="new-password" placeholder="Новый, от 8 символов" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      {err && <span className={css.pwerr}>{err}</span>}
      <button type="submit" className={css.pwgo} disabled={busy || !cur || !next}>{busy ? "Меняю…" : "Сменить пароль"}</button>
    </form>
  );
}
