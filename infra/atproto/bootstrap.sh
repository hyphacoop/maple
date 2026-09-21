#!/usr/bin/env bash
# Bring the harness up from cold, attach the PDS to the relay, mint the identity
# and create the harness account with it.
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

say "minting the identity"
# The DID is minted HERE, not by the PDS, and the account is then created *with*
# it -- the same flow the network uses to migrate an account between PDSes
# (ADR 0002 §6). This is not harness convenience: it is the only way
# rotationKeys ends up as exactly [recovery, ops]. A PDS that mints its own DID
# puts PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX in that list and can rewrite
# the identity forever after, which is the outcome the whole custody model
# exists to prevent. The harness runs the production sequence so the runbook in
# infra/gcp/README.md cannot drift away from something that is actually tested.
#
# The account, NOT a record. Ordering forces the split: the consumer starts from
# the live tip when it has no cursor, so it must be running BEFORE a record is
# written -- and it cannot start without MAPLE_DIDS, which is this DID. So the
# identity is set up here and the record is written afterwards, by
# `yarn --cwd services/atproto-consumer test:smoke`.
SPEC="$IDENTITY_STATE/spec.json"

# Reuse across runs, the way the old createAccount/createSession pair did: a
# surviving pds-data volume still holds the account, and re-minting would strand
# it behind a handle that is already taken. A spec whose account the PDS no
# longer has (someone ran `down -v`) is stale, so it is discarded rather than
# trusted -- otherwise every later step fails against a DID nothing serves.
if [ -f "$SPEC" ] && curl -fsS -X POST "$PDS_URL/xrpc/com.atproto.server.createSession" \
    -H 'content-type: application/json' \
    -d "{\"identifier\":\"$HANDLE\",\"password\":\"$ACCOUNT_PASSWORD\"}" >/dev/null 2>&1; then
  DID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["did"])' "$SPEC")
  echo "reusing the existing identity: $DID"
else
  rm -rf "$IDENTITY_STATE"
  mkdir -p "$IDENTITY_STATE"
  chmod 700 "$IDENTITY_STATE"

  # Two rotation keys in priority order, exactly as ADR 0002 §1 describes: the
  # first can nullify anything the second does. In dev and prod the first is
  # generated offline and never touches a server; here both are per-run scratch.
  RECOVERY_KEY=$(identity keygen --out "$IDENTITY_STATE/recovery.key")
  OPS_KEY=$(identity keygen --out "$IDENTITY_STATE/ops.key")
  # A third key, ours only until the PDS has its own: genesis has to name some
  # signing key, and createAccount for a DID the PDS did not mint has to be
  # authorised by whatever key the document currently names. Discarded below.
  SIGNING_KEY=$(identity keygen --out "$IDENTITY_STATE/initial-signing.key")

  cat > "$SPEC" <<SPECJSON
{
  "did": "",
  "handle": "$HANDLE",
  "pdsEndpoint": "$PDS_URL",
  "plcUrl": "$PLC_URL",
  "rotationKeys": ["$RECOVERY_KEY", "$OPS_KEY"],
  "verificationMethods": { "atproto": "$SIGNING_KEY" }
}
SPECJSON

  DID=$(identity genesis --spec "$SPEC" --key-file "$IDENTITY_STATE/ops.key")
  [ -n "$DID" ] || fail "genesis produced no DID"
  echo "minted $DID on $PLC_URL"

  identity create-account --spec "$SPEC" \
    --signing-key-file "$IDENTITY_STATE/initial-signing.key" \
    --email "$ACCOUNT_EMAIL" --password "$ACCOUNT_PASSWORD" >/dev/null

  # The PDS generated its own signing key at createAccount; adopt it, and drop
  # ours. From here the PDS holds a signing key and nothing else: it cannot move
  # the identity, and its own updateHandle will fail because it would sign with
  # a key that is not in rotationKeys. That failure is the design, not a bug.
  identity rotate-signing-key --spec "$SPEC" \
    --key-file "$IDENTITY_STATE/ops.key" --pds-password "$ACCOUNT_PASSWORD" >/dev/null
  rm -f "$IDENTITY_STATE/initial-signing.key"

  # createAccount carrying a `did` is the migration path, so the account lands
  # DEACTIVATED -- the network's sequence is create, import the old repo, then
  # go live. A deactivated account emits nothing to the firehose, so without
  # this the relay never learns the repo exists and every read-path assertion
  # downstream fails on "the relay does not know repo". Deliberately after the
  # rotation: the first commits must be signed by the key the document names.
  #
  # Needs the ops key because activateAccount insists the PDS's own rotation key
  # is in the document: `activate` borrows it for that one call and takes it back
  # out, leaving rotationKeys as the spec states it (ADR 0002 §1).
  identity activate --spec "$SPEC" \
    --key-file "$IDENTITY_STATE/ops.key" --pds-password "$ACCOUNT_PASSWORD"
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

say "checking the document matches the spec"
# `plan` is keyless and is the same command CI and the drift alarm run.
# Passing here proves the custody property this whole flow exists for:
# rotationKeys is EXACTLY what the spec lists, so the PDS's own rotation key --
# which it would have inserted had it minted the DID -- is not in the document.
identity plan --spec "$SPEC" || fail "the DID document does not match $SPEC"

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
