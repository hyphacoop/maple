#!/usr/bin/env bash
# Assert a SCRAPED DOCUMENT completes the whole publish loop:
#   Firestore -> publishBill (services/atproto-publisher) -> PDS -> relay
#             -> jetstream -> services/atproto-consumer -> Firestore
#
# The consumer's `yarn test:smoke` proves the read half, from a record it seeds
# by hand. This proves the write half, from the shape the scraper actually
# stores, and then proves the thing the publisher turns on: a re-scrape that changes only
# fetchedAt must produce NO commit. That second assertion cannot be made with a
# unit test.
#
# Unlike the other harness scripts this runs its OWN Firestore emulator, on
# firebase.atproto-e2e.json's ports: the functions emulator can only fire
# triggers against a Firestore emulator it started itself, so it cannot reuse
# the one `yarn --cwd services/atproto-consumer emulator` runs. The consumer is
# pointed at that emulator too.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

# Only the DID: this check seeds its own documents and asserts nothing about
# any record the consumer's seeder wrote.
load_state DID

PUBLISHER_DIR="$REPO_ROOT/services/atproto-publisher"
E2E_CONFIG="$REPO_ROOT/firebase.atproto-e2e.json"
E2E_PROJECT=$GCLOUD_PROJECT

[ -f "$E2E_CONFIG" ] || fail "missing $E2E_CONFIG"

# Read back rather than re-typed: the emulator ports for this check live in
# firebase.atproto-e2e.json because firebase-tools owns that file's schema, and
# endpoints.env records the allocation so the harness's port registry stays
# complete. Typing 8081 here as well is how the two drift.
E2E_FIRESTORE_PORT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["emulators"]["firestore"]["port"])' "$E2E_CONFIG")
[ -n "$E2E_FIRESTORE_PORT" ] || fail "no emulators.firestore.port in $E2E_CONFIG"

# The other half of this script, run by `emulators:exec` below once the
# Firestore and functions emulators are up.
#
# It re-enters this same file through bash rather than being passed as an inline
# script, because emulators:exec runs its argument through /bin/sh -- which is
# dash on Debian and Ubuntu, where `set -o pipefail`, `local` and lib.sh's arrays
# are all bash-only. Re-entry also means the inner half gets lib.sh (sourced at
# the top of this file) instead of respelling its wait loop and its
# consumer-ready pattern, and shellcheck reads it as ordinary code rather than
# as a string.
run_inside_emulators() {
  # Set HERE, after lib.sh was sourced at the top of this file, and the ordering
  # is load-bearing: lib.sh sources endpoints.env under `set -a`, so it sets
  # FIRESTORE_EMULATOR_HOST to the DEV emulator on 8080. The other way round the
  # consumer attaches to that one, nothing this check writes is ever seen, and
  # the failure surfaces two minutes later inside e2e-drive.ts pointing at the
  # wrong thing.
  export FIRESTORE_EMULATOR_HOST=localhost:$E2E_FIRESTORE_PORT
  local log=${E2E_CONSUMER_LOG:-/tmp/atp-e2e-consumer.log}

  echo "starting the consumer against $FIRESTORE_EMULATOR_HOST"
  # Job control on, so the consumer gets a process group of its own and the trap
  # below can take the whole tree down -- see stop_consumer_group in lib.sh for
  # why the pid alone is not enough.
  set -m
  ( cd "$CONSUMER_DIR" && yarn dev ) >"$log" 2>&1 &
  local consumer=$!
  set +m
  # shellcheck disable=SC2064  # expand the pid now, not when the trap fires
  trap "stop_consumer_group $consumer 5" EXIT

  # The pid, so a consumer that dies during startup says so at once rather than
  # after the full budget. lib.sh owns the ready pattern, so a rename in the
  # consumer breaks this, recovery.sh and CI together rather than one at a time.
  wait_for_consumer "$log" 60 "$consumer" || {
    echo "the consumer never attached to the jetstream tail:"
    cat "$log"
    return 1
  }

  cd "$PUBLISHER_DIR" && node --import tsx scripts/e2e-drive.ts
}

if [ "${1:-}" = "--inside-emulators" ]; then
  run_inside_emulators
  exit 0
fi

say "checking the harness is up"
curl -fsS "$PDS_URL/xrpc/_health" >/dev/null 2>&1 \
  || fail "no PDS at $PDS_URL — run ./bootstrap.sh first"
wait_for jetstream "$JETSTREAM_DEBUG_URL/readyz" 30 \
  || fail "jetstream is not ready — $DC_CMD logs jetstream"

say "building the publisher"
( cd "$PUBLISHER_DIR" && yarn build >/dev/null )

# The publisher reads these straight from the environment; defineSecret makes
# ATP_PDS_PASSWORD a Secret Manager mount in production and a plain env var
# here. Credentials are the harness's throwaway account, from endpoints.env.
export ATP_PDS_URL=$PDS_URL
export ATP_PDS_HANDLE=$HANDLE
export ATP_PDS_PASSWORD=$ACCOUNT_PASSWORD
export GCLOUD_PROJECT=$E2E_PROJECT
export MAPLE_DIDS=$DID
export JETSTREAM_URL

# The functions emulator resolves defineSecret() values from this file. Without
# it the run still works — readConfig() reads the environment, which is what a
# Secret Manager mount produces in production too — but the emulator prints an
# alarming "Unable to access secret environment variables" error on the way
# past, and a red line in a passing check is a line someone will chase.
# .gitignored: these are the harness's throwaway credentials, but the file is
# still a credentials file.
printf 'ATP_PDS_PASSWORD=%s\n' "$ACCOUNT_PASSWORD" > "$PUBLISHER_DIR/.secret.local"
trap 'rm -f "$PUBLISHER_DIR/.secret.local"' EXIT

say "running the loop"
cat <<INFO
  pds        $PDS_URL as $HANDLE
  jetstream  $JETSTREAM_URL
  emulator   localhost:$E2E_FIRESTORE_PORT (project $E2E_PROJECT)
  did filter $DID
INFO

# Hand back to run_inside_emulators() above, now that the emulators exist. The
# consumer is started in there rather than out here so it sees the
# FIRESTORE_EMULATOR_HOST of the emulator this command owns, and so it is killed
# on the way out whether the driver passed or failed.
npx -y firebase-tools@15 emulators:exec \
  --config "$E2E_CONFIG" \
  --project "$E2E_PROJECT" \
  --only firestore,functions \
  "bash '$HARNESS_DIR/publish-check.sh' --inside-emulators"

pass "a scraped bill document completed the publish loop, and a fetchedAt-only
      re-scrape produced no commit"
