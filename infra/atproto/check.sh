#!/usr/bin/env bash
# Assert the seeded record completed the whole trip:
#   PDS -> relay -> jetstream -> services/atproto-consumer -> Firestore emulator
#
# This is the harness's acceptance criterion. Exits non-zero, loudly, if any leg of it
# did not happen — and says which leg, so a failure points somewhere.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

TIMEOUT=${TIMEOUT:-60}
load_state

echo "did:      $DID"
echo "project:  $GCLOUD_PROJECT"
echo "emulator: $FIRESTORE_EMULATOR_HOST"

# leg 1-2: did the relay take the commit at all?
curl -fsS "$RELAY_URL/xrpc/com.atproto.sync.listRepos?limit=100" | grep -q "$DID" \
  || fail "the relay does not know this repo — the PDS -> relay leg is broken.
      $DC_CMD logs relay"
echo "ok:       relay knows the repo"

# leg 3-4: did the consumer write THIS record? Matching on the cid means an old
# document left by an earlier run cannot pass for a fresh delivery.
printf 'waiting for the document (up to %ss) ' "$TIMEOUT"
for _ in $(seq 1 "$TIMEOUT"); do
  if body=$(fsget "atpJetstreamProfiles/$DID") && printf '%s' "$body" | grep -q "$CID"; then
    printf ' found\n\n'
    printf '%s' "$body" | python3 -m json.tool
    pass "a record put on the local PDS arrived in the Firestore emulator,
      via PDS -> relay -> jetstream -> consumer. cid=$CID"
    exit 0
  fi
  printf .
  sleep 1
done
printf ' NOT FOUND\n' >&2

cat >&2 <<HINT

FAIL: the newest seeded record never reached Firestore (an older document for
this DID may well be sitting there — that is not a pass). In order:
  - is the consumer running, and against THIS jetstream?
      JETSTREAM_URL=$JETSTREAM_URL GCLOUD_PROJECT=$GCLOUD_PROJECT \\
        yarn --cwd services/atproto-consumer dev
  - is it pointed at THIS emulator/project? a different GCLOUD_PROJECT writes
    to a different emulator namespace and looks identical to "nothing arrived".
  - did it resume from a stale cursor? a cursor left by a previous run of a
    DIFFERENT jetstream is a meaningless seq here (jetstream sequence spaces are
    per-host). Check atpJetstreamMeta in the emulator.
  - is jetstream itself ingesting?
      $DC_CMD logs jetstream
HINT
exit 1
