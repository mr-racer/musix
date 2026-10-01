import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useAuth } from "../api/auth";
import { MiniPlayer } from "../player/MiniPlayer";
import { BrandMark } from "./Brand";
import { GatefoldHost } from "./Gatefold";
import { Icon, type IconName } from "./icons";
import css from "./Shell.module.css";

type Tab = { to: string; label: string; short: string; icon: IconName; owner?: boolean };
const TABS: Tab[] = [
  { to: "/", label: "Главная", short: "Главная", icon: "Home" },
  { to: "/player", label: "Плеер", short: "Плеер", icon: "Player" },
  { to: "/library", label: "Библиотека", short: "Библ", icon: "Library" },
  { to: "/search", label: "Поиск", short: "Поиск", icon: "Search" },
  { to: "/admin", label: "Админка", short: "Админ", icon: "Shield", owner: true },
];

/** v1's desktop shell (a floating nav pill at the left, settings at the bottom) and its
 *  phone tab bar; the mini player sits above the content's bottom edge. */
export function Shell() {
  const role = useAuth((s) => s.role);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = TABS.filter((t) => !t.owner || role === "owner");
  const active = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));
  return (
    <div className={css.shell}>
      <Link to="/" className={css.brand} aria-label="MusiX — главная">
        <BrandMark size={30} />
      </Link>
      <nav className={css.rail} aria-label="Разделы">
        {tabs.map((t) => (
          <Link key={t.to} to={t.to} className={active(t.to) ? css.railOn : css.railItem} aria-current={active(t.to) ? "page" : undefined}>
            <Icon name={t.icon} size={18} />
            <span>{t.short}</span>
          </Link>
        ))}
      </nav>
      <Link to="/settings" className={css.settings} aria-label="Настройки">
        <Icon name="Settings" size={18} />
      </Link>
      <main className={css.main}>
        <Outlet />
      </main>
      <MiniPlayer />
      <GatefoldHost />
      <nav className={css.tabbar} aria-label="Разделы">
        {tabs.map((t) => (
          <Link key={t.to} to={t.to} className={active(t.to) ? css.tabOn : css.tab}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
