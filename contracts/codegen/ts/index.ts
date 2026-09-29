// The web client's typed API: openapi-fetch over the generated `paths`.
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema";

export type Schemas = components["schemas"];

export function makeClient(baseUrl: string, accessToken: () => string | null) {
  const client = createClient<paths>({ baseUrl });
  const auth: Middleware = {
    onRequest({ request }) {
      const t = accessToken();
      if (t) request.headers.set("Authorization", `Bearer ${t}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}

// Compile-time proof that the shapes the web app relies on exist as typed.
export async function _typecheck(c: ReturnType<typeof makeClient>): Promise<string[]> {
  const home = await c.GET("/api/v2/home");
  const titles = home.data?.recentlyAdded.map((t) => t.title) ?? [];
  const sync = await c.GET("/api/v2/sync", { params: { query: { limit: 100 } } });
  for (const ch of sync.data?.changes ?? []) {
    if (ch.entity === "track" && ch.data) titles.push(ch.data.artistDisplay);
  }
  await c.POST("/api/v2/events/listens:batch", {
    body: { events: [{ clientEventId: crypto.randomUUID(), sessionId: "s", trackId: crypto.randomUUID(),
      startedAt: new Date().toISOString(), playedMs: 0, endReason: "stopped" }] },
  });
  return titles;
}
