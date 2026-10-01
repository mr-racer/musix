import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "dark" | "light";
const KEY = "musix.theme";
const media = () => matchMedia("(prefers-color-scheme: light)");
const listeners = new Set<() => void>();

export function themePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref | null) ?? "system";
  } catch {
    return "system";
  }
}

function resolve(p: ThemePref): "dark" | "light" {
  return p === "system" ? (media().matches ? "light" : "dark") : p;
}

function apply(): void {
  document.documentElement.dataset.theme = resolve(themePref());
  for (const l of listeners) l();
}

export function setThemePref(p: ThemePref): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* private mode: this session only */
  }
  apply();
}

media().addEventListener("change", apply);

export function useTheme(): "dark" | "light" {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => resolve(themePref()),
  );
}
