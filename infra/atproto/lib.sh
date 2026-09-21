# Shared by bootstrap.sh, recovery.sh, publish-check.sh and the CI job. Source
# it, don't run it. Every value the scripts and compose both need lives in the
# two env files rather than being re-typed per script.

# shellcheck disable=SC2034  # these are consumed by the sourcing scripts
HARNESS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HARNESS_DIR/../.." && pwd)
CONSUMER_DIR="$REPO_ROOT/services/atproto-consumer"
IDENTITY_DIR="$REPO_ROOT/services/atproto-identity"
# Per-run identity material: the spec genesis writes a DID back into, and the
# rotation keys it is signed with. Gitignored, and scratch by design -- these
# keys are worth nothing off this machine. Sits beside .harness-state and dies
# with `down -v` for the same reason the PDS volume does.
IDENTITY_STATE="$HARNESS_DIR/.harness-identity"
STATE_FILE="$HARNESS_DIR/.harness-state"

set -a
. "$HARNESS_DIR/images.env"
. "$HARNESS_DIR/endpoints.env"
set +a

PLC_URL=http://localhost:$PLC_PORT
PDS_URL=http://localhost:$PDS_PORT
RELAY_URL=http://localhost:$RELAY_PORT
JETSTREAM_URL=${JETSTREAM_URL:-http://localhost:$JETSTREAM_PORT}
JETSTREAM_DEBUG_URL=http://localhost:$JETSTREAM_DEBUG_PORT
# What the relay knows the PDS as. Must match the DID document's service
# endpoint, which the PDS derives from PDS_HOSTNAME=localhost and PDS_PORT.
PDS_HOST_PORT=localhost:$PDS_PORT
# Exported, like the values sourced above: a child process started after
# sourcing this (the consumer, in recovery.sh and in CI) must see the harness's
# jetstream, not the consumer's public-network default.
export PLC_URL PDS_URL RELAY_URL JETSTREAM_URL JETSTREAM_DEBUG_URL

# Always invoke compose this way. Without --env-file the stack has no image
# references at all ("service pds has neither an image nor a build context"), so
# hints printed to the user must use this spelling too.
dc() { docker compose --env-file "$HARNESS_DIR/images.env" --env-file "$HARNESS_DIR/endpoints.env" -f "$HARNESS_DIR/compose.yml" "$@"; }
DC_CMD="docker compose --env-file infra/atproto/images.env --env-file infra/atproto/endpoints.env -f infra/atproto/compose.yml"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }
pass() { printf '\n\033[32mPASS: %s\033[0m\n' "$*"; }

# The repo root is pinned to node 20; the services are node >= 22.15. Find a 22+
# without requiring the caller's shell to have one selected. Lives here rather
# than in one script because bootstrap.sh, recovery.sh and identity-check.sh all
# need it.
node22() {
  local n
  for n in "$HOME/.nvm/versions/node"/v2[2-9]*/bin/node; do
    [ -x "$n" ] && { echo "$n"; return; }
  done
  echo node
}
NODE=${NODE:-$(node22)}

# services/atproto-identity's CLI. Run from the package directory so `--import
# tsx` resolves out of its own node_modules.
identity() { ( cd "$IDENTITY_DIR" && "$NODE" --import tsx src/cli.ts "$@" ); }

# One top-level field out of a JSON object on stdin.
jqp() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(sys.argv[1],""))' "$1"; }

wait_for() { # wait_for <name> <url> [seconds]
  local name=$1 url=$2 limit=${3:-90}
  printf 'waiting for %s (%s) ' "$name" "$url"
  for _ in $(seq 1 "$limit"); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then printf ' ok\n'; return 0; fi
    printf .
    sleep 1
  done
  printf ' TIMED OUT\n' >&2
  return 1
}

# The line the consumer prints once it is ATTACHED to the jetstream tail. It
# comes from the transport's onConnect (src/index.ts), so it means the websocket
# is up -- not, as the cursor-decision line above it in the log does, that the
# consumer is about to open one. recovery.sh, publish-check.sh and the CI job all
# wait on it, and a rename in the consumer must break them together rather than
# one at a time.
#
# Waiting on the wrong line is not a slow start, it is a lost record: .live() is
# called after the cursor decision is logged, and on a cursorless start -- which
# is every harness run -- anything published in between is gone, surfacing two
# minutes later as a timeout blaming the consumer.
CONSUMER_READY='\[consumer\] subscribed'

# Wait until a consumer whose output goes to <log-file> is attached to the tail.
# Everything that starts a consumer and then writes a record must use this.
#
# Given the consumer's pid it also gives up the moment that process dies, rather
# than waiting out the whole budget: a consumer that exits during startup is the
# usual failure, and its log is the answer, so the caller should print it.
wait_for_consumer() { # wait_for_consumer <log-file> [seconds] [pid]
  local log=$1 limit=${2:-30} pid=${3:-}
  for _ in $(seq 1 "$limit"); do
    grep -qE "$CONSUMER_READY" "$log" 2>/dev/null && return 0
    [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}

# Stop a consumer started in its own process group (`set -m`) and make sure it
# is actually gone.
#
# SIGTERM to the GROUP first: `yarn dev` runs tsx which runs node, so signalling
# the pid alone kills yarn and orphans the node process. Then SIGKILL, because
# TERM alone is not reliable here -- the consumer's shutdown aborts an in-flight
# websocket read and does not always finish, which was observed leaving two
# orphaned nodes behind. A survivor keeps tailing jetstream and joins the next
# run as a second writer: the race recovery.sh warns about, arriving from a
# previous run.
stop_consumer_group() { # stop_consumer_group <pgid> [seconds]
  local pgid=$1 limit=${2:-10}
  kill -- -"$pgid" 2>/dev/null || true
  for _ in $(seq 1 "$limit"); do
    kill -0 -- -"$pgid" 2>/dev/null || return 0
    sleep 1
  done
  kill -9 -- -"$pgid" 2>/dev/null || true
}

# Firestore emulator REST. "Bearer owner" is the emulator's admin credential;
# without it the REST API evaluates firestore.rules and answers
# PERMISSION_DENIED, which reads exactly like an absent document.
fsurl() { printf 'http://%s/v1/projects/%s/databases/(default)/documents/%s' "$FIRESTORE_EMULATOR_HOST" "$GCLOUD_PROJECT" "$1"; }
fsget() { curl -fsS -H "Authorization: Bearer owner" "$(fsurl "$1")" 2>/dev/null; }
fspatch() { curl -fsS -X PATCH -H "Authorization: Bearer owner" -H 'content-type: application/json' "$(fsurl "$1")" -d "$2" >/dev/null; }

# load_state [KEY...] — source .harness-state and require the given keys,
# defaulting to everything `yarn seed` writes. bootstrap.sh writes DID alone, so
# a caller that only needs the identity must say `load_state DID` rather than
# demanding record keys that do not exist until something has been seeded.
load_state() {
  [ -f "$STATE_FILE" ] || fail "no .harness-state — run ./bootstrap.sh first"
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  local k keys=("$@")
  if [ ${#keys[@]} -eq 0 ]; then
    keys=(DID CID COLLECTION RKEY DOC_PATH)
  fi
  for k in "${keys[@]}"; do
    [ -n "${!k:-}" ] || fail "$STATE_FILE is missing $k — re-run 'yarn --cwd services/atproto-consumer seed'"
  done
}
