import { queryOptions } from "@tanstack/react-query";
import { remember } from "../lib/images";
import { api, ok } from "./client";

export const instanceQuery = queryOptions({
  queryKey: ["instance"],
  queryFn: () => ok(api.GET("/api/v2/instance")),
  staleTime: 60_000,
});

/** Screen queries: each response's `images` map is remembered for covers and the player. */
async function withImages<T extends { images?: Record<string, import("./client").Schemas["ImageData"]> }>(p: Promise<T>): Promise<T> {
  const r = await p;
  remember(r.images);
  return r;
}

/** The home counts the week in the device's local days. */
export const homeQuery = queryOptions({
  queryKey: ["home"],
  queryFn: () => withImages(ok(api.GET("/api/v2/home", { params: { query: { tzOffsetMinutes: -new Date().getTimezoneOffset() } } }))),
  staleTime: 60_000,
});

export const contextQuery = (trackId: string) =>
  queryOptions({
    queryKey: ["player-context", trackId],
    queryFn: () => withImages(ok(api.GET("/api/v2/player/context/{track_id}", { params: { path: { track_id: trackId } } }))),
    staleTime: 10 * 60_000,
  });

export const summaryQuery = queryOptions({
  queryKey: ["library-summary"],
  queryFn: () => ok(api.GET("/api/v2/library/summary")),
});

export const albumQuery = (id: string) =>
  queryOptions({
    queryKey: ["album", id],
    queryFn: () => withImages(ok(api.GET("/api/v2/albums/{album_id}", { params: { path: { album_id: id } } }))),
  });

export const artistQuery = (id: string) =>
  queryOptions({
    queryKey: ["artist", id],
    queryFn: () => withImages(ok(api.GET("/api/v2/artists/{artist_id}/page", { params: { path: { artist_id: id } } }))),
  });
