import { api } from "../api/client";
import type { Bio } from "./model";

export const bioQuery = (id: string) => ({
  queryKey: ["bio", id],
  queryFn: async (): Promise<Bio> => (await api.GET("/api/v2/artists/{artist_id}/bio", { params: { path: { artist_id: id } } })).data ?? null,
  staleTime: 30 * 60_000,
});
