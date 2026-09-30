import uuid

from fastapi import APIRouter, Request, Response

from musix.api.deps import Owner, Session
from musix.contexts.admin import schemas as S
from musix.contexts.admin import service

router = APIRouter(tags=["admin"])


@router.get("/instance", response_model=S.InstanceOut)
async def instance(s: Session) -> S.InstanceOut:
    """Open: whether first-run setup is due, the mode, the name, the LLM status."""
    return await service.instance_view(s)


@router.get("/admin/instance", response_model=S.InstanceSettings)
async def get_instance(p: Owner, s: Session) -> S.InstanceSettings:
    return await service.get_instance(s)


@router.put("/admin/instance", response_model=S.InstanceSettings)
async def put_instance(body: S.InstanceSettings, p: Owner, s: Session) -> S.InstanceSettings:
    return await service.put_instance(s, body)


@router.get("/admin/members", response_model=list[S.MemberOut])
async def members(p: Owner, s: Session) -> list[S.MemberOut]:
    return await service.members(s)


@router.patch("/admin/members/{member_id}", response_model=S.MemberOut)
async def patch_member(
    member_id: uuid.UUID, body: S.MemberPatch, p: Owner, s: Session, request: Request
) -> S.MemberOut:
    """Grant or revoke a server folder (`indexRoot`, under the library roots); `premium`
    is display-only (v1)."""
    return await service.patch_member(s, member_id, body, request.app.state.settings.library_roots)


@router.delete("/admin/members/{member_id}", status_code=204)
async def delete_member(
    member_id: uuid.UUID, body: S.DeleteIn, p: Owner, s: Session, request: Request
) -> Response:
    mfs = await service.purge(s, p.account_id, member_id, body.confirm_email)
    if mfs:
        await request.app.state.queue.configure_task("intel:reown").defer_async(
            media_file_ids=[str(m) for m in mfs]
        )
    return Response(status_code=204)


@router.get("/admin/ops", response_model=S.OpsOut)
async def ops(p: Owner, s: Session, request: Request) -> S.OpsOut:
    return await service.ops(s, request.app.state.settings.rendition_budget_gb)


@router.post("/admin/renditions/backfill", response_model=S.BackfillOut, status_code=202)
async def backfill(p: Owner, request: Request) -> S.BackfillOut:
    """Queue processing (probe, loudness, renditions) for every file that has not had it."""
    job = await request.app.state.queue.configure_task(
        "media:backfill", queueing_lock="media:backfill"
    ).defer_async()
    return S.BackfillOut(job=str(job))
