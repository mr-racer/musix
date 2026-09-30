import { api, ok } from "./client";
import { sync } from "./sync";

/** Playlist edits: client-generated ids make a retried request a no-op on the server; the
 *  mirror catches up through `/sync` (the WS `sync.changed` follows every edit). */
export async function createPlaylist(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await ok(api.POST("/api/v2/playlists", { body: { id, name } }));
  void sync();
  return id;
}

export async function addToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
  await ok(api.POST("/api/v2/playlists/{playlist_id}/items", {
    params: { path: { playlist_id: playlistId } },
    body: { items: trackIds.map((trackId) => ({ itemId: crypto.randomUUID(), trackId })) },
  }));
  void sync();
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  await ok(api.PATCH("/api/v2/playlists/{playlist_id}", { params: { path: { playlist_id: id } }, body: { name } }));
  void sync();
}

export async function deletePlaylist(id: string): Promise<void> {
  await ok(api.DELETE("/api/v2/playlists/{playlist_id}", { params: { path: { playlist_id: id } } }));
  void sync();
}

export async function removeItem(playlistId: string, itemId: string): Promise<void> {
  await ok(api.DELETE("/api/v2/playlists/{playlist_id}/items/{item_id}", { params: { path: { playlist_id: playlistId, item_id: itemId } } }));
  void sync();
}

export async function moveItem(playlistId: string, itemId: string, afterItemId: string | null): Promise<void> {
  await ok(api.PATCH("/api/v2/playlists/{playlist_id}/items/{item_id}", {
    params: { path: { playlist_id: playlistId, item_id: itemId } },
    body: { afterItemId },
  }));
  void sync();
}
