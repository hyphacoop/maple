#!/usr/bin/env bash
# Write one app.bsky.actor.profile record to the local PDS and record what was
# written in .harness-state, so check.sh and recovery.sh can assert against THIS
# record rather than whatever happens to be in Firestore.
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

put=$(curl -fsS -X POST "$PDS_URL/xrpc/com.atproto.repo.putRecord" \
  -H "authorization: Bearer $JWT" \
  -H 'content-type: application/json' \
  -d "{\"repo\":\"$DID\",\"collection\":\"app.bsky.actor.profile\",\"rkey\":\"self\",\"record\":{\"\$type\":\"app.bsky.actor.profile\",\"displayName\":\"$DISPLAY_NAME\",\"description\":\"seeded by infra/atproto/seed.sh at $(date -u +%FT%TZ)\"}}")
CID=$(printf '%s' "$put" | jqp cid)
[ -n "$CID" ] || fail "putRecord returned no cid: $put"

printf 'DID=%s\nCID=%s\n' "$DID" "$CID" > "$STATE_FILE"
echo "seeded $DID cid=$CID"
