"""Run INSIDE the api-snap container (`docker exec -i … python - < mint_v2.py`): an
access token per migrated account, signed with the instance's own key, keyed by the v1
user id. The passwords stay unknown; the tokens last 15 minutes."""

import asyncio
import json

import sqlalchemy as sa

from musix.contexts.identity import security as sec
from musix.infra import db, secrets
from musix.settings import Settings


async def main() -> None:
    st = Settings()
    keys = secrets.load_or_create(st.secrets_dir)
    engine = db.make_engine(st)
    async with engine.connect() as c:
        rows = await c.execute(sa.text(
            "select m.v1_user_id, a.id, a.role, d.id from migr_account_map m "
            "join accounts a on a.id = m.account_id "
            "join devices d on d.account_id = a.id and d.name = 'v1 import'"
        ))
        out = {v1: sec.issue_access(keys, sec.Principal(aid, dev, role)) for v1, aid, role, dev in rows}
    await engine.dispose()
    print(json.dumps(out))


asyncio.run(main())
