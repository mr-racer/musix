import uuid
from typing import Any

from fastapi import APIRouter, Request, Response

from musix.api.deps import Auth, Session
from musix.contexts.assistant import schemas as S
from musix.contexts.assistant import service

router = APIRouter(tags=["assistant"])


async def _queue(request: Request, s: Any, p: Any, kind: str, body: Any) -> S.TurnAccepted:
    from musix.contexts.admin.service import ai_allowed
    from musix.errors import Forbidden

    if not await ai_allowed(s, p.role):
        raise Forbidden("the owner has turned AI off for members")
    account_id = p.account_id
    turn_id = await service.create(s, account_id, kind, body.model_dump(mode="json"))
    await s.commit()
    await request.app.state.queue.configure_task("assistant:turn", priority=10).defer_async(
        turn_id=str(turn_id)
    )
    return S.TurnAccepted(turn_id=turn_id)


@router.post("/assistant/turns", response_model=S.TurnAccepted, status_code=202)
async def assistant_turn(
    body: S.AssistantTurnIn, p: Auth, s: Session, request: Request
) -> S.TurnAccepted:
    """One message to the assistant. Progress: `assistant.stage` over the WebSocket;
    then `assistant.done`, and the result is `GET /assistant/turns/{turnId}`."""
    return await _queue(request, s, p, "assistant", body)


@router.post("/track-chat/turns", response_model=S.TurnAccepted, status_code=202)
async def track_chat_turn(
    body: S.TrackChatIn, p: Auth, s: Session, request: Request
) -> S.TurnAccepted:
    """The drawer chat about one of the account's tracks, or «explain this line»."""
    if body.mode == "lyric_explain" and not body.selected_line:
        from musix.errors import Invalid

        raise Invalid("selected_line is required for mode=lyric_explain")
    return await _queue(request, s, p, "track_chat", body)


@router.get("/assistant/turns/{turn_id}", response_model=S.TurnOut)
async def get_turn(turn_id: uuid.UUID, p: Auth, s: Session, request: Request) -> S.TurnOut:
    st = request.app.state
    return await service.get(
        s, st.settings.public_base_url, st.secrets.media_hmac, p.account_id, turn_id
    )


@router.delete("/assistant/contexts/{context_id}", status_code=204)
async def release_context(context_id: str, p: Auth) -> Response:
    """v1 kept this for the client to free a turn context early; v2 contexts live a
    minute in the ai worker and expire on their own — the call is accepted as a no-op."""
    return Response(status_code=204)


@router.get("/assistant/discoveries", response_model=S.DiscoveriesOut)
async def discoveries(
    p: Auth, s: Session, request: Request, lang: str = "ru", limit: int = 12
) -> S.DiscoveriesOut:
    """Hook cards: sample links with both sides in the library, recurring producers,
    artists with a bio. Empty when there is nothing verifiable to show."""
    import asyncio

    from musix.assistant import data
    from musix.assistant.discoveries import build_discoveries

    st = request.app.state
    data.configure(st.settings.procrastinate_conninfo)

    def build() -> list[dict[str, Any]]:
        try:
            return build_discoveries(
                None, str(p.account_id), lang=lang, limit=max(1, min(limit, 24))
            )
        finally:
            data.close_all()

    cards = await asyncio.to_thread(build)
    return await service.with_tracks(
        s, st.settings.public_base_url, st.secrets.media_hmac, p.account_id, cards
    )


@router.get("/assistant/ideas", response_model=S.IdeasOut)
async def ideas(p: Auth, s: Session, request: Request, lang: str = "ru", limit: int = 6) -> Any:
    """v1 `/metadata/random-facts` for the assistant's front page: refined facts in the
    listener's language about songs and artists they own, one per subject, at most 220
    characters (length is held down by selection, never by an ellipsis)."""
    st = request.app.state
    return await service.ideas(
        s,
        st.settings.public_base_url,
        st.secrets.media_hmac,
        p.account_id,
        lang if lang in ("ru", "en") else "ru",
        max(1, min(limit, 12)),
    )
