#!/bin/bash
# Lisa replay test. Run before every push that touches Lisa (api/_lib/lisa-*,
# sms-agent, yelp-agent, client-history, estimate-agent). Sends nothing.
set -a
. /Users/jake/AIOS/.env
. /Users/jake/AIOS/higrade-invoicing/.env
. /Users/jake/AIOS/telegram-bot/.env
set +a
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$SUPABASE_SERVICE_KEY}"
cd "$(dirname "$0")/../.." && node --no-warnings tests/lisa/replay.mjs "$@"
