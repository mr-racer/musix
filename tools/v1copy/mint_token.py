"""Print {account_id: jwt} for every user of the v1 copy, signed with the COPY's own
secret. Runs inside the copy: `docker exec -i musix-v1copy python - < mint_token.py`.
The payload shape is v1's AuthService.issue_token."""

import json
import os
import sqlite3
import time

import jwt

db = sqlite3.connect(f"file:{os.environ['MUSIX_METADATA_DB']}?mode=ro", uri=True)
now = int(time.time())
out = {}
for uid, email, role in db.execute("select id, email, role from users"):
    out[uid] = jwt.encode({"sub": uid, "email": email, "role": role, "iat": now,
                           "exp": now + 7 * 86400}, os.environ["MUSIX_JWT_SECRET"], algorithm="HS256")
print(json.dumps(out))
