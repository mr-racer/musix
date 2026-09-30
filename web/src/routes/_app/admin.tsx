import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "../../api/auth";
import css from "./admin/admin.module.css";

/** The owner's admin: its own chunks (a member is redirected before any of them loads;
 *  the server refuses every admin endpoint regardless). */
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: () => {
    if (useAuth.getState().role !== "owner") throw redirect({ to: "/" });
  },
  component: Admin,
});

const TABS = [
  { to: "/admin", label: "Участники" },
  { to: "/admin/library", label: "Библиотеки" },
  { to: "/admin/ai", label: "ИИ" },
  { to: "/admin/instance", label: "Сервер" },
  { to: "/admin/ops", label: "Состояние" },
] as const;

function Admin() {
  return (
    <div className={css.page}>
      <header className={css.head}>
        <h1 className={css.title}>Админка</h1>
        <nav className={css.tabs} aria-label="Разделы админки">
          {TABS.map((t) => (
            <Link key={t.to} to={t.to} activeOptions={{ exact: true }} className={css.tab} activeProps={{ className: css.tabOn }}>{t.label}</Link>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
