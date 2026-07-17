#!/usr/bin/env bash
set -euo pipefail

exec ssh \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -N \
  -L 4332:127.0.0.1:4332 \
  -L 55432:127.0.0.1:5432 \
  -L 56333:127.0.0.1:6333 \
  hetzner

