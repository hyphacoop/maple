# Shared by bootstrap.sh and recovery.sh. Source it, don't
# run it. Every value the scripts and compose both need lives in the two env
# files rather than being re-typed per script.

# shellcheck disable=SC2034  # these are consumed by the sourcing scripts
HARNESS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HARNESS_DIR/../.." && pwd)
CONSUMER_DIR="$REPO_ROOT/services/atproto-consumer"
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

# The line the consumer prints once it is attached to the jetstream tail, either
# way round. One spelling: recovery.sh and the CI job both wait on this, and a
# rename in the consumer must break them together rather than one at a time.
CONSUMER_READY='stored cursor|live tip'

wait_for_log() { # wait_for_log <file> <extended-regex> [seconds]
  local file=$1 pattern=$2 limit=${3:-30}
  for _ in $(seq 1 "$limit"); do
    grep -qE "$pattern" "$file" 2>/dev/null && return 0
    sleep 1
  done
  return 1
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
