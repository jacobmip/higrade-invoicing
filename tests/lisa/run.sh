#!/bin/bash
# Lisa replay test. Run before every push that touches Lisa (api/_lib/lisa-*,
# sms-agent, yelp-agent, client-history, estimate-agent, scripts/phone-prompt).
# Sends nothing. --phone runs the phone cases, --all runs both.
set -a
. /Users/jake/AIOS/.env
. /Users/jake/AIOS/higrade-invoicing/.env
. /Users/jake/AIOS/telegram-bot/.env
set +a
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$SUPABASE_SERVICE_KEY}"
cd "$(dirname "$0")/../.."
if [ "$1" = "--phone" ]; then shift; exec node --no-warnings tests/lisa/phone.mjs "$@"; fi
if [ "$1" = "--all" ]; then shift; node --no-warnings tests/lisa/replay.mjs "$@"; a=$?; node --no-warnings tests/lisa/phone.mjs "$@"; b=$?; exit $((a|b)); fi
node --no-warnings tests/lisa/replay.mjs "$@"
