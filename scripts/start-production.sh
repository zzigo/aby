#!/usr/bin/env bash
set -euo pipefail

cd /opt/apps/aby
set -a
source ./.env
set +a

exec /usr/bin/node ./apps/web/build/index.js

