#!/usr/bin/env bash
# Seed the local Postgres mirror from Supabase using pg_dump + psql.
#
# Requires:
#   - Docker Compose stack running (`docker compose up -d` in this folder)
#   - SUPABASE_DB_URL env var pointing at your Supabase Postgres
#   - pg_dump and psql installed locally (brew install libpq)
#
# This is destructive on the LOCAL DB only: it drops and recreates the
# `public` schema. The Supabase source is read-only here.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is not set." >&2
  echo "Get it from: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/settings/database" >&2
  echo "Then:  export SUPABASE_DB_URL='postgres://...@.../postgres'" >&2
  exit 1
fi

LOCAL_PG_URL="${LOCAL_PG_URL:-postgresql://higrade:localdev@localhost:5432/higrade}"

# Resolve absolute paths so this works no matter where you run it from.
HERE="$(cd "$(dirname "$0")" && pwd)"
DUMP_FILE="${HERE}/.last_dump.sql"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Seeding local mirror"
echo "  Source: ${SUPABASE_DB_URL%%@*}@... (redacted)"
echo "  Target: ${LOCAL_PG_URL}"

# Confirm the local DB is reachable before we touch the source
if ! psql "${LOCAL_PG_URL}" -c '\q' >/dev/null 2>&1; then
  echo "Cannot connect to local Postgres at ${LOCAL_PG_URL}" >&2
  echo "Is the Docker Compose stack running?  docker compose ps" >&2
  exit 1
fi

echo ""
echo "--- Dumping public schema from Supabase ---"
# --no-owner / --no-privileges so we don't inherit Supabase-specific role
# grants the local DB doesn't have.
pg_dump \
  --schema=public \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  --format=plain \
  "${SUPABASE_DB_URL}" > "${DUMP_FILE}"

DUMP_SIZE=$(wc -c < "${DUMP_FILE}" | tr -d ' ')
echo "  dump size: ${DUMP_SIZE} bytes"

echo ""
echo "--- Restoring into local Postgres ---"
# Drop and recreate the public schema cleanly
psql "${LOCAL_PG_URL}" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO higrade;
SQL

# Apply the dump
psql "${LOCAL_PG_URL}" -v ON_ERROR_STOP=1 -f "${DUMP_FILE}" >/dev/null

echo ""
echo "--- Row counts ---"
psql "${LOCAL_PG_URL}" -At -c "
  SELECT relname || ': ' || n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
  ORDER BY relname;
"

echo ""
echo "Seed complete."
