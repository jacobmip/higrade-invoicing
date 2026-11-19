#!/bin/bash
# Estimate assistant test. Run before any push touching api/_lib/doc-agent.js,
# src/docAgent.js or api/_lib/pricing-brain.js. Sends nothing.
set -a
. /Users/jake/AIOS/.env
. /Users/jake/AIOS/higrade-invoicing/.env
. /Users/jake/AIOS/telegram-bot/.env
set +a
cd "$(dirname "$0")/../.."
exec node --no-warnings tests/doc-agent/run.mjs "$@"
