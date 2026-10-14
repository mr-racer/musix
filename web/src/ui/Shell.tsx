import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "../api/auth";
import { installHotkeys } from "../lib/hotkeys";
import { MiniPlayer } from "../player/MiniPlayer";
import { AchievementHost } from "./Achievements";
import { BrandMark } from "./Brand";
import { GatefoldHost } from "./Gatefold";
import { Icon, type IconName } from "./icons";
import css from "./Shell.module.css";
import { ThemeButton } from "./ThemeButton";

type Tab = { to: string; label: string; short: string; icon: IconName; owner?: boolean };
const TABS: Tab[] = [
  { to: "/", label: "Главная", short: "Главная", icon: "Home" },
  { to: "/player", label: "Плеер", short: "Плеер", icon: "Player" },
  { to: "/library", label: "Библиотека", short: "Библ", icon: "Library" },
  { to: "/search", label: "Поиск", short: "Поиск", icon: "Search" },
  { to: "/admin", label: "Админка", short: "Админ", icon: "Shield", owner: true },
];

/** v1's desktop shell (a floating glass nav island at the left, settings a quiet glyph in
 *  the top right corner, where the owner wanted it) and its phone tab bar; the mini player
 *  sits above the content's bottom edge. On the player and the home, dark cover-lit
 *  surfaces in both app themes, the whole shell takes the dark tokens (the light theme
 *  comes to the new screens in one pass at the end, design/code/roadmap.md). */
export function Shell() {
  const role = useAuth((s) => s.role);
  // the resolved location changes with the page, inside the page change (lib/pageMotion.ts)
  const path = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  const tabs = TABS.filter((t) => !t.owner || role === "owner");
  const active = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));
  // the island's blob springs to the open section; on a page outside the sections it fades where it stood
  const on = tabs.findIndex((t) => active(t.to));
  const stood = useRef(0);
  if (on >= 0) stood.current = on;
  const nav = useNavigate();
  const here = useRef(path);
  here.current = path;
  useEffect(() => installHotkeys({
    libraryHasSearch: () => here.current === "/library",
    search: () => {
      const quick = document.querySelector<HTMLInputElement>("input[data-hotkey-search]");
      if (quick) quick.focus();
      else void nav({ to: "/search" });
    },
    // the player's queue window listens for this; elsewhere the player opens with it
    queue: () => {
      if (here.current === "/player") window.dispatchEvent(new Event("mx:queue"));
      else void nav({ to: "/player" }).then(() => setTimeout(() => window.dispatchEvent(new Event("mx:queue")), 700));
    },
  }), [nav]);
  return (
    <div className={css.shell} data-mx-theme={path === "/player" || path === "/" ? "dark" : undefined}>
      <Link to="/" className={css.brand} aria-label="MusiX — главная">
        <BrandMark size={30} />
      </Link>
      <nav className={css.rail} aria-label="Разделы" data-sky-edge="island">
        <span className={css.blob} aria-hidden data-off={on < 0 ? "" : undefined} style={{ ["--i" as string]: stood.current }} />
        {tabs.map((t, i) => (
          <Link key={t.to} to={t.to} className={active(t.to) ? css.railOn : css.railItem} aria-current={active(t.to) ? "page" : undefined}
            style={{ viewTransitionName: `island-item-${i}` }}>
            <Icon name={t.icon} size={18} />
            <span>{t.short}</span>
          </Link>
        ))}
      </nav>
      <div className={css.corner}>
        <ThemeButton />
        <Link to="/settings" className={css.settings} aria-label="Настройки" title="Настройки" aria-current={path === "/settings" ? "page" : undefined}>
          <Icon name="Settings" size={18} />
        </Link>
      </div>
      <main className={path === "/player" ? css.mainStage : css.main}>
        <Outlet />
      </main>
      <MiniPlayer />
      <GatefoldHost />
      <AchievementHost />
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
