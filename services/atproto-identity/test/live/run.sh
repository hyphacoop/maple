#!/usr/bin/env bash
# The live tier: the custody scenarios against a real PLC directory.
#
#   yarn test:live [drift|recovery|all]
#
# `yarn test` proves how operations are built and how the plan diff reads. It
# cannot prove what a PLC does with them -- that a stale document makes plan
# fail, or that the recovery key really does override the ops key. Those are
# the two properties ADR 0002 rests on, and they are assertions about the PLC
# server's behaviour, so they need one.
#
# Everything here is scratch: a per-run identity on a throwaway directory, both
# rotation keys generated into .live-state and thrown away with it. Nothing
# reaches plc.directory and nothing outlives the run.
#
# KEEP=1 leaves the stack and the state up to poke at.

set -euo pipefail
cd "$(dirname "$0")"

LIVE_DIR=$(pwd)
PKG_DIR=$(cd ../.. && pwd)
STATE="$LIVE_DIR/.live-state"
SPEC="$STATE/spec.json"
OPS_KEY="$STATE/ops.key"
RECOVERY_KEY="$STATE/recovery.key"
SIGNING_KEY="$STATE/initial-signing.key"

PLC_PORT=${PLC_PORT:-2592}
PLC_URL=http://localhost:$PLC_PORT
export PLC_PORT

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }
pass() { printf '\n\033[32mPASS: %s\033[0m\n' "$*"; }

# The repo root is pinned to node 20; this package is node >= 22.15. Find a 22+
# without requiring the caller's shell to have one selected.
node22() {
  local n
  for n in "$HOME/.nvm/versions/node"/v2[2-9]*/bin/node; do
    [ -x "$n" ] && { echo "$n"; return; }
  done
  echo node
}
NODE=${NODE:-$(node22)}

# Run from the package directory so `--import tsx` resolves out of its own
# node_modules.
identity() { ( cd "$PKG_DIR" && "$NODE" --import tsx src/cli.ts "$@" ); }

dc() { docker compose -f "$LIVE_DIR/compose.yml" "$@"; }

cleanup() {
  [ -n "${KEEP:-}" ] && { say "KEEP=1: $PLC_URL and $STATE left up"; return; }
  dc down -v >/dev/null 2>&1 || true
  rm -rf "$STATE"
}
trap cleanup EXIT

say "PLC on $PLC_URL (a cold run builds it from the pinned commit -- minutes)"
dc up -d --wait

for _ in $(seq 1 60); do
  curl -fsS --max-time 3 "$PLC_URL/_health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 3 "$PLC_URL/_health" >/dev/null || fail "PLC never became healthy on $PLC_URL"

say "minting a scratch identity"
rm -rf "$STATE"
mkdir -p "$STATE"

# Two rotation keys in priority order, exactly as ADR 0002 1 describes: the
# first can nullify anything the second does. In dev and prod the first is
# generated offline and never touches a server; here both are per-run scratch.
RECOVERY_DIDKEY=$(identity keygen --out "$RECOVERY_KEY")
OPS_DIDKEY=$(identity keygen --out "$OPS_KEY")
# Genesis has to name some signing key. No PDS here to hand its own over, so
# this one stays for the length of the run.
SIGNING_DIDKEY=$(identity keygen --out "$SIGNING_KEY")

cat > "$SPEC" <<SPECJSON
{
  "did": "",
  "handle": "maple.live.test",
  "pdsEndpoint": "http://pds.localhost:2583",
  "plcUrl": "$PLC_URL",
  "rotationKeys": ["$RECOVERY_DIDKEY", "$OPS_DIDKEY"],
  "verificationMethods": { "atproto": "$SIGNING_DIDKEY" }
}
SPECJSON

DID=$(identity genesis --spec "$SPEC" --key-file "$OPS_KEY")
[ -n "$DID" ] || fail "genesis produced no DID"
pass "minted $DID"

identity plan --spec "$SPEC" >/dev/null || fail "plan reports drift on a freshly minted identity"

export PLC_URL SPEC DID OPS_KEY RECOVERY_KEY
# shellcheck source=scenarios.sh
. "$LIVE_DIR/scenarios.sh"

case "${1:-all}" in
  drift) scenario_drift ;;
  recovery) scenario_recovery ;;
  all)
    scenario_drift
    scenario_recovery
    ;;
  *) fail "unknown scenario: $1 (drift|recovery|all)" ;;
esac

say "live identity scenarios passed"
