import uuid

from fastapi import APIRouter, Response

from musix.api.deps import Auth, Session
from musix.contexts.playlists import schemas as S
from musix.contexts.playlists import service

router = APIRouter(tags=["playlists"])


@router.get("/playlists", response_model=list[S.PlaylistOut])
async def list_playlists(p: Auth, s: Session) -> list[S.PlaylistOut]:
    return await service.list_playlists(s, p.account_id)


@router.post("/playlists", response_model=S.PlaylistOut, status_code=201)
async def create(body: S.PlaylistIn, p: Auth, s: Session) -> S.PlaylistOut:
    return await service.create(s, p.account_id, body)


@router.patch("/playlists/{playlist_id}", response_model=S.PlaylistOut)
async def update(
    playlist_id: uuid.UUID, body: S.PlaylistPatch, p: Auth, s: Session
) -> S.PlaylistOut:
    return await service.update(s, p.account_id, playlist_id, body)


@router.delete("/playlists/{playlist_id}", status_code=204)
async def delete(playlist_id: uuid.UUID, p: Auth, s: Session) -> Response:
    await service.delete(s, p.account_id, playlist_id)
    return Response(status_code=204)


@router.get("/playlists/{playlist_id}/items", response_model=list[S.ItemOut])
async def items(playlist_id: uuid.UUID, p: Auth, s: Session) -> list[S.ItemOut]:
    return await service.items(s, p.account_id, playlist_id)


@router.post("/playlists/{playlist_id}/items", response_model=list[S.ItemOut], status_code=201)
async def add_items(
    playlist_id: uuid.UUID, body: S.ItemsAdd, p: Auth, s: Session
) -> list[S.ItemOut]:
    return await service.add_items(s, p.account_id, playlist_id, body)


@router.patch("/playlists/{playlist_id}/items/{item_id}", response_model=S.ItemOut)
async def move_item(
    playlist_id: uuid.UUID, item_id: uuid.UUID, body: S.ItemMove, p: Auth, s: Session
) -> S.ItemOut:
    return await service.move_item(s, p.account_id, playlist_id, item_id, body)


@router.delete("/playlists/{playlist_id}/items/{item_id}", status_code=204)
async def remove_item(playlist_id: uuid.UUID, item_id: uuid.UUID, p: Auth, s: Session) -> Response:
    await service.remove_item(s, p.account_id, playlist_id, item_id)
    return Response(status_code=204)
