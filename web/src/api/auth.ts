import { create } from "zustand";

/** The session. The access token lives only in memory; the refresh token is the server's
 *  HttpOnly cookie (scoped to /api/v2/auth), so page script can never read or leak it. A
 *  reload costs one refresh. Nothing about the session is in localStorage. */
export type Role = "owner" | "member";

interface Tokens {
  accessToken: string;
  expiresIn: number;
  accountId: string;
  deviceId: string;
  role: string;
}

interface AuthState {
  status: "unknown" | "in" | "out";
  access: string | null;
  accountId: string | null;
  deviceId: string | null;
  role: Role | null;
}

export const useAuth = create<AuthState>(() => ({ status: "unknown", access: null, accountId: null, deviceId: null, role: null }));

const accountListeners = new Set<(accountId: string | null) => void | Promise<void>>();
/** Local data keyed by the account (the mirror, the outbox, the player) resets through this. */
export function onAccountChange(fn: (accountId: string | null) => void | Promise<void>): () => void {
  accountListeners.add(fn);
  return () => accountListeners.delete(fn);
}

async function apply(t: Tokens | null): Promise<void> {
  const prev = useAuth.getState().accountId;
  const next = t?.accountId ?? null;
  if (prev !== next) for (const fn of accountListeners) await fn(next);
  useAuth.setState(
    t
      ? { status: "in", access: t.accessToken, accountId: t.accountId, deviceId: t.deviceId, role: t.role === "owner" ? "owner" : "member" }
      : { status: "out", access: null, accountId: null, deviceId: null, role: null },
  );
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Браузер";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

const device = () => ({ name: deviceName(), platform: "web" as const, appVersion: import.meta.env.VITE_APP_VERSION ?? "2.0.0" });

export class AuthError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

async function post(path: string, body: unknown): Promise<Tokens> {
  const r = await fetch(`/api/v2/auth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new AuthError(r.status, p.detail ?? p.title ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export async function login(email: string, password: string): Promise<void> {
  await apply(await post("login", { email, password, device: device() }));
}

export async function register(email: string, password: string, inviteCode: string): Promise<void> {
  await apply(await post("register", { email, password, inviteCode, device: device() }));
}

export async function setup(email: string, password: string, mode: "personal" | "shared"): Promise<void> {
  await apply(await post("setup", { email, password, mode, device: device() }));
}

let inflight: Promise<boolean> | null = null;

/** One refresh however many callers ask at once (a 401 storm after sleep = one request).
 *  Resolves false when the session is over; then the app shows the login. */
export function refresh(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      const r = await fetch("/api/v2/auth/refresh", { method: "POST", credentials: "same-origin" });
      if (r.status === 401 || r.status === 403) {
        await apply(null);
        return false;
      }
      if (!r.ok) throw new Error(`refresh: HTTP ${r.status}`); // the server is down: keep the session
      await apply(await r.json());
      return true;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const beforeSignOut = new Set<() => Promise<void> | void>();
/** Runs while the session is still valid: the player ends its listen, the outbox flushes —
 *  the wipe that follows would otherwise drop what was not sent yet. */
export function onBeforeSignOut(fn: () => Promise<void> | void): () => void {
  beforeSignOut.add(fn);
  return () => beforeSignOut.delete(fn);
}

export async function logout(): Promise<void> {
  for (const fn of beforeSignOut) await Promise.resolve(fn()).catch(() => undefined);
  const access = useAuth.getState().access;
  if (access)
    await fetch("/api/v2/auth/logout", { method: "POST", headers: { authorization: `Bearer ${access}` }, credentials: "same-origin" }).catch(() => undefined);
  await apply(null);
}

/** On load: the cookie decides. A network failure leaves the status unknown (retry later). */
export async function bootstrap(): Promise<void> {
  try {
    await refresh();
  } catch {
    useAuth.setState({ status: "out" });
  }
}

/** Resolves once the first refresh has answered (route guards wait on it). */
export function authReady(): Promise<AuthState["status"]> {
  const now = useAuth.getState().status;
  if (now !== "unknown") return Promise.resolve(now);
  return new Promise((resolve) => {
    const off = useAuth.subscribe((s) => {
      if (s.status !== "unknown") {
        off();
        resolve(s.status);
      }
    });
  });
}
