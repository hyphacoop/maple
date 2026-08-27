#!/usr/bin/env bash
# Bring the harness up from cold, attach the PDS to the relay, and seed a record.
#
#   ./bootstrap.sh
#
# ORDER MATTERS. The relay subscribes to a brand-new host at its CURRENT
# firehose offset — it does not backfill (cmd/relay/HACKING.md). So the host has
# to be registered BEFORE the account and the record exist, or the record is
# published into a window nobody is listening to and never arrives.
#
# To write another record into an already-running stack, use ./seed.sh.

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

say "seeding a record"
"$HARNESS_DIR/seed.sh"
load_state

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

==> up and seeded. now run the consumer against it:

    # terminal 1 — Firestore emulator
    yarn --cwd services/atproto-consumer emulator

    # terminal 2 — consumer (needs node >= 22.15)
    JETSTREAM_URL=$JETSTREAM_URL GCLOUD_PROJECT=$GCLOUD_PROJECT \\
      MAPLE_DIDS=$DID yarn --cwd services/atproto-consumer dev

    # terminal 3 — write a record while it watches, then assert it arrived
    infra/atproto/seed.sh && infra/atproto/check.sh

  the record to look for is $COLLECTION/$RKEY in $DID,
  which the consumer indexes to $DOC_PATH.
NEXT
