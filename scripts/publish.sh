#!/usr/bin/env bash
# Count the messages since the last run into a data repo, commit, and push. The data is small, so
# the full history is published.
# Usage: scripts/publish.sh <calibnet|mainnet>
# Env: LOTUS_API (node RPC, default per network), DATA_DIR (data repo), NO_PUSH=1 (skip the push),
# WAIT_SYNC=<minutes> (first wait that long for the node to come up and sync; needs the node on this host).
set -euo pipefail

net=${1:?usage: publish.sh <calibnet|mainnet>}
case $net in
  calibnet) repo=filecoin-message-mix-data-calibration; lotus=calib-lotus ;;
  mainnet) repo=filecoin-message-mix-data-main; lotus=main-lotus ;;
  *) echo "unknown network: $net" >&2; exit 2 ;;
esac

APP=$(cd "$(dirname "$0")/.." && pwd)
DATA=${DATA_DIR:-$APP/../$repo}
started=$(date +%s)

# One run per data repo at a time.
exec 9>"$DATA/.git/publish.lock"
flock -n 9 || { echo "$net: another publish is running" >&2; exit 1; }

# The fetch merges into the files on disk, so they must match the last commit.
if [ -n "$(git -C "$DATA" status --porcelain)" ]; then
  echo "$net: $DATA has uncommitted changes" >&2
  exit 1
fi

# Right after boot the node is still starting or syncing. Wait with its own CLI: wait-api until it
# answers, then sync wait until its head is current. sync wait redraws its progress 4 times a second,
# so its output is dropped. timeout ends both, the whole process group, when the time is up.
if [ -n "${WAIT_SYNC:-}" ]; then
  export LOTUS_PATH=${LOTUS_PATH:-/opt/filecoin/run/$lotus}
  echo "$net: waiting up to $WAIT_SYNC min for $lotus to sync"
  if ! timeout "${WAIT_SYNC}m" bash -c '"$0" wait-api --timeout "$1" && "$0" sync wait' \
      "${LOTUS_BIN:-/opt/filecoin/bin/$lotus}" "${WAIT_SYNC}m" >/dev/null; then
    echo "$net: $lotus not up and synced after $WAIT_SYNC min" >&2
    exit 1
  fi
  echo "$net: $lotus synced after $(($(date +%s) - started))s"
fi

node "$APP/scripts/fetch-messages.ts" --out "$DATA" --commit

if [ "${NO_PUSH:-}" = 1 ]; then
  echo "$net: committed locally, push skipped (NO_PUSH=1)"
else
  git -C "$DATA" push --quiet origin main
  echo "$net: published $(git -C "$DATA" log -1 --format='%h %s')"
fi
echo "$net: done in $(($(date +%s) - started))s"
