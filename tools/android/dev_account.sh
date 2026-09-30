#!/usr/bin/env bash
# Dev only: a known login for the migrated library the app is tested on. On the DEV copy
# of the migration (musix_mig — rebuilt by every `make migrate`), the account with the
# largest library gets the email mig-owner@example.com and the password mig-pass-123.
# Never run against anything but a migrated dev database: the real email is overwritten.
set -euo pipefail
DB="${MUSIX_SNAP_DB:-musix_mig}"
[ "$DB" != musix ] || { echo "refusing: $DB is not a migrated dev copy" >&2; exit 1; }
HASH=$(docker exec -i musix-v2-dev-api-snap-1 python -c "from musix.contexts.identity.security import hash_password; print(hash_password('mig-pass-123'))")
docker exec -i musix-v2-dev-postgres-1 psql -U musix -d "$DB" -qAt -v h="$HASH" <<'SQL'
UPDATE accounts SET email = 'mig-owner@example.com', password_hash = :'h'
WHERE id = (SELECT account_id FROM tracks GROUP BY account_id ORDER BY count(*) DESC LIMIT 1);
SELECT 'tracks: ' || count(*) FROM tracks WHERE account_id = (SELECT id FROM accounts WHERE email = 'mig-owner@example.com');
SQL
