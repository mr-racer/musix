import createClient from "openapi-fetch";
import type { paths } from "./schema.gen";
import { refresh, useAuth } from "./auth";

/** Every API call: the bearer from memory; a 401 triggers the single-flight refresh and
 *  one retry. The request body is buffered first so the retry can resend it. */
export async function authed(input: Request): Promise<Response> {
  const body = input.method === "GET" || input.method === "HEAD" ? undefined : await input.clone().arrayBuffer();
  const send = (token: string | null) => {
    const headers = new Headers(input.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(new Request(input, { headers, body }));
  };
  const first = await send(useAuth.getState().access);
  if (first.status !== 401) return first;
  if (!(await refresh())) return first;
  return send(useAuth.getState().access);
}

export const api = createClient<paths>({ baseUrl: "", fetch: authed });

export class ApiError extends Error {
  constructor(public status: number, public problem: { title?: string; detail?: string }) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
}

/** Unwraps an openapi-fetch result: data, or a thrown ApiError (Query shows it). */
export async function ok<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const r = await p;
  if (r.error !== undefined || !r.response.ok) throw new ApiError(r.response.status, (r.error ?? {}) as { detail?: string });
  return r.data as T;
}

export type Schemas = import("./schema.gen").components["schemas"];

/** Signed media URLs are absolute (the server's public base). In dev the page is on the
 *  Vite server, which proxies /m and /i: keeping them same-origin lets Web Audio read them. */
export function mediaUrl(u: string): string {
  if (!import.meta.env.DEV) return u;
  try {
    const p = new URL(u);
    return /^\/(m|i|download)\//.test(p.pathname) ? p.pathname + p.search : u;
  } catch {
    return u;
  }
}
