#!/usr/bin/env bash
# Write one org.mapletestimony.bill record to the local PDS and record what was
# written in .harness-state, so check.sh and recovery.sh can assert against THIS
# record rather than whatever happens to be in Firestore.
#
# The record is the consumer's own fixture — the same file the lexicon validator
# checks and the unit tests drive events from — with fetchedAt stamped to now.
# One source of truth for "a valid MAPLE bill", and a fresh fetchedAt gives every
# seed a distinct cid, which is what lets the assertions tell a new delivery from
# a document an earlier run left behind.
#
# Split out of bootstrap.sh because the recovery scenarios seed repeatedly, and
# they must do it with `set -e` intact: a silently failed seed would leave a
# stale CID in the state file and every later assertion would pass vacuously.
#
# Waits only on the PDS. The scenarios seed while jetstream or the relay is
# deliberately dead, so waiting on those here would deadlock the tests.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

wait_for pds "$PDS_URL/xrpc/_health" >/dev/null

session_json() {
  # After the first seed the account exists, so go straight to createSession —
  # createAccount would just 400 on every subsequent call.
  if [ -f "$STATE_FILE" ]; then
    curl -fsS -X POST "$PDS_URL/xrpc/com.atproto.server.createSession" \
      -H 'content-type: application/json' \
      -d "{\"identifier\":\"$HANDLE\",\"password\":\"$ACCOUNT_PASSWORD\"}"
    return
  fi
  local created
  created=$(curl -sS -X POST "$PDS_URL/xrpc/com.atproto.server.createAccount" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$ACCOUNT_EMAIL\",\"handle\":\"$HANDLE\",\"password\":\"$ACCOUNT_PASSWORD\"}")
  if [ -n "$(printf '%s' "$created" | jqp did)" ]; then
    printf '%s' "$created"
    return
  fi
  # Account exists but the state file went away (a `down -v` keeps PDS data only
  # if the volume survived, so this happens when only the file was deleted).
  echo "createAccount refused, reusing the account: $created" >&2
  curl -fsS -X POST "$PDS_URL/xrpc/com.atproto.server.createSession" \
    -H 'content-type: application/json' \
    -d "{\"identifier\":\"$HANDLE\",\"password\":\"$ACCOUNT_PASSWORD\"}"
}

session=$(session_json)
DID=$(printf '%s' "$session" | jqp did)
JWT=$(printf '%s' "$session" | jqp accessJwt)
[ -n "$DID" ] && [ -n "$JWT" ] || fail "could not obtain a DID/session from $PDS_URL"

# The rkey is the PUBLISHER's convention, and seeding is what the publisher
# will eventually do, so deriving it here is right. The document path is
# the consumer's -- src/records.ts owns `atpBills` and `billDocId` -- and it is
# spelled again below only because reading it out of the TS package would put a
# node 22 dependency into a script that otherwise needs curl and python3. Today
# the two conventions coincide; if they stop, check.sh fails loudly rather than
# passing, and its hint block says to look here.
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT
meta=$(FIXTURE="$FIXTURE_DIR/bill.record.json" REPO="$DID" OUT="$BODY_FILE" python3 <<'PY'
import datetime, json, os

record = json.load(open(os.environ["FIXTURE"]))
record["fetchedAt"] = (
    datetime.datetime.now(datetime.timezone.utc)
    .isoformat(timespec="milliseconds")
    .replace("+00:00", "Z")
)
collection = record["$type"]
rkey = f'{record["court"]}-{record["billId"]}'
json.dump(
    {"repo": os.environ["REPO"], "collection": collection, "rkey": rkey, "record": record},
    open(os.environ["OUT"], "w"),
)
print(collection, rkey, f"atpBills/{rkey}")
PY
)
read -r COLLECTION RKEY DOC_PATH <<< "$meta"

put=$(curl -fsS -X POST "$PDS_URL/xrpc/com.atproto.repo.putRecord" \
  -H "authorization: Bearer $JWT" \
  -H 'content-type: application/json' \
  --data-binary "@$BODY_FILE")
CID=$(printf '%s' "$put" | jqp cid)
[ -n "$CID" ] || fail "putRecord returned no cid: $put"

cat > "$STATE_FILE" <<STATE
DID=$DID
CID=$CID
COLLECTION=$COLLECTION
RKEY=$RKEY
DOC_PATH=$DOC_PATH
STATE
echo "seeded $COLLECTION/$RKEY in $DID cid=$CID"
