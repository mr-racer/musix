import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "dark" | "light";
const KEY = "musix.theme";
const media = () => matchMedia("(prefers-color-scheme: light)");
const listeners = new Set<() => void>();
let sessionPref: ThemePref | undefined;

export function themePref(): ThemePref {
  if (sessionPref) return sessionPref;
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function resolve(p: ThemePref): "dark" | "light" {
  return p === "system" ? (media().matches ? "light" : "dark") : p;
}

function apply(): void {
  const theme = resolve(themePref());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f2f1f6" : "#0d0d10");
  for (const l of listeners) l();
}

export function setThemePref(p: ThemePref): void {
  sessionPref = p;
  try {
    localStorage.setItem(KEY, p);
    sessionPref = undefined;
  } catch {
    /* private mode: this session only */
  }
  apply();
}

media().addEventListener("change", apply);
window.addEventListener("storage", (event) => { if (event.key === KEY || event.key === null) apply(); });

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    themePref,
  );
}

export function useTheme(): "dark" | "light" {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => resolve(themePref()),
  );
}
