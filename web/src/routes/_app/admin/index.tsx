import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api, ok, type Schemas } from "../../../api/client";
import { num } from "../../../lib/format";
import { Icon } from "../../../ui/icons";
import css from "./admin.module.css";

export const Route = createFileRoute("/_app/admin/")({ component: Members });

const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("ru") : "—");

/** v1's «Участники»: who is on the server (counts only — never their tracks), the invites. */
function Members() {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["admin", "members"], queryFn: () => ok(api.GET("/api/v2/admin/members")) });
  const invites = useQuery({ queryKey: ["admin", "invites"], queryFn: () => ok(api.GET("/api/v2/invites")) });
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = (code: string) => `${location.origin}/login?invite=${encodeURIComponent(code)}`;

  async function invite() {
    const inv = await ok(api.POST("/api/v2/invites"));
    setFresh(inv.code);
    setCopied(false);
    void qc.invalidateQueries({ queryKey: ["admin", "invites"] });
  }

  return (
    <>
      <section className={css.card}>
        <div className={css.eyebrow}>Приглашения</div>
        <div className={css.row}>
          <span className={css.label}>Инвайт — одноразовый, живёт 7 дней<span className={css.hint}>Друг открывает ссылку и регистрируется</span></span>
          <button type="button" className={css.cta} onClick={() => void invite()}>Создать инвайт</button>
        </div>
        {fresh && (
          <div className={css.row}>
            <span className={css.label}><span className={css.code}>{fresh}</span><span className={css.hint}>{link(fresh)}</span></span>
            <button type="button" className={css.ghost} onClick={async () => {
              try { await navigator.clipboard.writeText(link(fresh)); setCopied(true); } catch { setCopied(false); }
            }}><Icon name="Copy" size={14} /> {copied ? "Скопировано" : "Копировать ссылку"}</button>
          </div>
        )}
        {(invites.data ?? []).filter((i) => !i.consumed && Date.parse(i.expiresAt) > Date.now()).map((i) => (
          <div key={i.code} className={css.row}>
            <span className={css.label}><span className={css.code}>{i.code}</span><span className={css.hint}>до {date(i.expiresAt)}</span></span>
            <button type="button" className={css.danger} onClick={async () => { await ok(api.DELETE("/api/v2/invites/{code}", { params: { path: { code: i.code } } })); void qc.invalidateQueries({ queryKey: ["admin", "invites"] }); }}>Отозвать</button>
          </div>
        ))}
      </section>

      <section className={css.card}>
        <div className={css.eyebrow}>Участники</div>
        <div className={css.scroll}>
          <table className={css.table}>
            <thead><tr><th>Аккаунт</th><th className={css.num}>Треки</th><th className={css.num}>Прослушивания</th><th className={css.num}>Огоньки</th><th className={css.num}>Устройства</th><th>Вход</th><th /></tr></thead>
            <tbody>{(members.data ?? []).map((m) => <Member key={m.id} m={m} />)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Member({ m }: { m: Schemas["MemberOut"] }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function remove() {
    setError("");
    const r = await api.DELETE("/api/v2/admin/members/{member_id}", { params: { path: { member_id: m.id } }, body: { confirmEmail: confirm ?? "" } });
    if (!r.response.ok) return setError(r.response.status === 400 ? "Email не совпадает" : "Не получилось удалить");
    setConfirm(null);
    void qc.invalidateQueries({ queryKey: ["admin", "members"] });
  }
  return (
    <>
      <tr>
        <td>
          <div>{m.displayName ?? m.email} {m.role === "owner" && <span className={css.owner}>владелец</span>}</div>
          <div className={css.muted}>{m.email}{m.inviteCode ? ` · инвайт ${m.inviteCode}` : ""} · с {date(m.createdAt)}</div>
        </td>
        <td className={css.num}>{num(m.tracks)}</td>
        <td className={css.num}>{num(m.listens)}</td>
        <td className={css.num}>{num(m.likes)}</td>
        <td className={css.num}>{m.devices}</td>
        <td>{date(m.lastLoginAt)}</td>
        <td>{m.role !== "owner" && confirm === null && <button type="button" className={css.danger} onClick={() => setConfirm("")} aria-label={`Удалить ${m.email}`}><Icon name="Trash" size={14} /></button>}</td>
      </tr>
      {confirm !== null && (
        <tr>
          <td colSpan={7}>
            <form className={css.tools} onSubmit={(e) => { e.preventDefault(); void remove(); }}>
              <span className={css.muted}>Удалить аккаунт и всю его библиотеку, прослушивания и плейлисты? Введи email, чтобы подтвердить:</span>
              <input className={css.field} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={m.email} aria-label="Email для подтверждения" autoFocus />
              <button type="submit" className={css.danger} disabled={confirm.trim().toLowerCase() !== m.email.toLowerCase()}>Удалить навсегда</button>
              <button type="button" className={css.ghost} onClick={() => setConfirm(null)}>Отмена</button>
              {error && <span className={css.error}>{error}</span>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
