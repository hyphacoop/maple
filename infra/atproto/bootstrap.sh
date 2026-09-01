#!/usr/bin/env bash
# Bring the harness up from cold, attach the PDS to the relay, and create the
# harness account.
#
#   ./bootstrap.sh
#
# ORDER MATTERS. The relay subscribes to a brand-new host at its CURRENT
# firehose offset — it does not backfill (cmd/relay/HACKING.md). So the host has
# to be registered BEFORE the account and the record exist, or the record is
# published into a window nobody is listening to and never arrives.
#
# Records are NOT written here. The consumer starts from the live tip when it
# has no cursor, so it has to be running before a record is put — and it cannot
# start without the DID this creates. So writing and asserting both belong to
# `yarn --cwd services/atproto-consumer test:smoke`, which runs afterwards.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

say "starting the stack"
dc up -d --wait   # blocks on the compose healthchecks for plc, pds and relay

# jetstream is the one service compose cannot health-check itself (distroless
# image, no shell for a CMD probe), so it is the one worth waiting on here.
say "health"
wait_for jetstream "$JETSTREAM_DEBUG_URL/healthz"

say "registering the PDS with the relay"
# The supported path is requestCrawl, and it CANNOT work against a local
# address: the handler's pre-flight relay.HostChecker.CheckHost always dials
# through ssrf.PublicOnlyTransport, which rejects loopback and RFC1918 and every
# port that isn't 80/443, so it fails before the handler's localhost allowance
# matters. The relay's slurper has no such problem — it skips the SSRF dialer
# for NoSSL hosts — so once the row exists, subscribing works normally.
# Full write-up in README.md, "requestCrawl cannot work against any local
# address".
#
# Try the real call first, so that upstream relaxing the pre-flight retires the
# escape hatch with no edit here.
if curl -fsS -u "admin:$RELAY_ADMIN_PASSWORD" "$RELAY_URL/admin/pds/list" \
     | grep -q "\"Host\":\"$PDS_HOST_PORT\""; then
  echo "already registered"
elif curl -fsS -u "admin:$RELAY_ADMIN_PASSWORD" \
     -X POST "$RELAY_URL/admin/pds/requestCrawl" \
     -H 'content-type: application/json' \
     -d "{\"hostname\":\"$PDS_HOST_PORT\"}" 2>/dev/null; then
  echo "requestCrawl accepted"
else
  echo "requestCrawl refused (expected locally — SSRF pre-flight); writing the host row instead"
  dc stop relay >/dev/null
  dc run --rm relay-register
  dc start relay >/dev/null
  wait_for relay "$RELAY_URL/_health"
fi

say "confirming the relay holds an active subscription"
# Both the API path and the escape hatch converge here, so a broken fallback
# cannot pass as a registration.
for _ in $(seq 1 30); do
  status=$(curl -fsS -u "admin:$RELAY_ADMIN_PASSWORD" "$RELAY_URL/admin/pds/list" | python3 -c '
import sys, json
hosts = json.load(sys.stdin)
h = [x for x in hosts if x.get("Host") == sys.argv[1]]
if not h:
    sys.exit("relay never registered the host")
if not h[0].get("HasActiveConnection"):
    sys.exit("relay registered the host but has not connected yet")
print("relay -> %s: connected, cursor=%s, accounts=%s" % (h[0]["Host"], h[0]["Cursor"], h[0]["UserCount"]))
' "$PDS_HOST_PORT" 2>&1) && break
  sleep 1
done
printf '%s\n' "$status"
case "$status" in
  "relay -> "*) ;;
  *) fail "$status — $DC_CMD logs relay" ;;
esac

say "creating the harness account"
# The account, NOT a record. Ordering forces the split: the consumer starts from
# the live tip when it has no cursor, so it must be running BEFORE a record is
# written -- and it cannot start without MAPLE_DIDS, which is this DID. So the
# identity is set up here and the record is written afterwards, by
# `yarn --cwd services/atproto-consumer test:smoke`.
created=$(curl -sS -X POST "$PDS_URL/xrpc/com.atproto.server.createAccount" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$ACCOUNT_EMAIL\",\"handle\":\"$HANDLE\",\"password\":\"$ACCOUNT_PASSWORD\"}")
DID=$(printf '%s' "$created" | jqp did)
if [ -z "$DID" ]; then
  # Already exists -- a PDS volume that survived a previous run.
  echo "createAccount refused, reusing the account: $created" >&2
  DID=$(curl -fsS -X POST "$PDS_URL/xrpc/com.atproto.server.createSession" \
    -H 'content-type: application/json' \
    -d "{\"identifier\":\"$HANDLE\",\"password\":\"$ACCOUNT_PASSWORD\"}" | jqp did)
fi
[ -n "$DID" ] || fail "could not obtain a DID from $PDS_URL"

# Only the DID: the record-level keys are written by `yarn seed`, which is what
# recovery.sh drives. Callers that need only the identity say `load_state DID`.
echo "DID=$DID" > "$STATE_FILE"
echo "account: $HANDLE -> $DID"

say "checking the DID document resolves through the local PLC"
# If this is not http://localhost:$PDS_PORT, the relay and jetstream will dial
# somewhere unreachable and nothing downstream works.
curl -fsS "$PLC_URL/$DID" | python3 -c '
import sys,json
doc=json.load(sys.stdin)
svc=[s for s in doc.get("service",[]) if s.get("id")=="#atproto_pds"]
print("service endpoint:", svc[0]["serviceEndpoint"] if svc else "MISSING")
'

cat <<NEXT

==> up. now run the consumer against it:

    # terminal 1 — Firestore emulator
    yarn --cwd services/atproto-consumer emulator

    # terminal 2 — consumer (needs node >= 22.15)
    JETSTREAM_URL=$JETSTREAM_URL GCLOUD_PROJECT=$GCLOUD_PROJECT \\
      MAPLE_DIDS=$DID yarn --cwd services/atproto-consumer dev

    # terminal 3 — write a record while it watches, and assert it arrives
    yarn --cwd services/atproto-consumer test:smoke

  test:smoke seeds an org.mapletestimony.bill into $DID and asserts it
  completes the trip. It reads its endpoints from endpoints.env, so it takes no
  arguments and means the same thing here as it does in CI.
NEXT
