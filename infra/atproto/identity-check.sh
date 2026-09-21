#!/usr/bin/env bash
# The custody scenarios from ADR 0002, run against the harness's real PLC.
#
#   ./identity-check.sh [drift|recovery|pds-key-rejected|all]
#
# Two of the three are not written here. `drift` and `recovery` are statements
# about a PLC directory and nothing else, so they live with the tool, in
# services/atproto-identity/test/live/scenarios.sh, where they also run against
# a PLC-only stack. This script points them at the harness's PLC and the
# identity bootstrap.sh minted, and adds the one scenario that needs a PDS.
#
# bootstrap.sh first: this asserts against the identity it minted.
#
# Every scenario mutates the live document on purpose and puts it back, and
# ends with `plan` clean -- a harness left drifted would make every later run
# lie.

# shellcheck disable=SC2034  # SPEC/OPS_KEY/RECOVERY_KEY and the two endpoints
# are consumed by scenarios.sh, sourced below.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

SPEC="$IDENTITY_STATE/spec.json"
[ -f "$SPEC" ] || fail "no $SPEC -- run ./bootstrap.sh first"
load_state DID

OPS_KEY="$IDENTITY_STATE/ops.key"
RECOVERY_KEY="$IDENTITY_STATE/recovery.key"
# The harness has a PDS, so the endpoints these scenarios drift to keep its
# port -- a spec that is wrong about the host but right about the shape.
DRIFT_ENDPOINT="http://drifted.localhost:$PDS_PORT"
ATTACKER_ENDPOINT="http://attacker.localhost:$PDS_PORT"

# Brings setfield, audit, restore_spec, scenario_drift and scenario_recovery,
# using the identity/say/pass/fail lib.sh just defined.
# shellcheck source=../../services/atproto-identity/test/live/scenarios.sh
. "$IDENTITY_DIR/test/live/scenarios.sh"

scenario_pds_key_rejected() {
  say "the PDS's rotation key is not in the document, and cannot sign for it"
  # The PDS holds PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX and would have put
  # it in rotationKeys had it minted this DID. It did not, so the key is inert
  # for this identity -- that is the single property the whole bring-your-own-DID
  # flow buys, and it is worth asserting rather than assuming. Needs a PDS,
  # which is why this one is here and the other two are not.
  local pds_hex pds_key
  pds_hex=$(grep 'PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX' "$HARNESS_DIR/compose.yml" |
    grep -o '[0-9a-f]\{64\}')
  [ -n "$pds_hex" ] || fail "could not read the PDS rotation key out of compose.yml"

  printf '%s\n' "$pds_hex" > "$IDENTITY_STATE/pds-rotation.key"
  pds_key=$(identity pubkey --key-file "$IDENTITY_STATE/pds-rotation.key")

  if curl -fsS "$PLC_URL/$DID/data" | grep -q "$pds_key"; then
    fail "the PDS rotation key $pds_key IS in the document -- the PDS minted this DID"
  fi
  pass "the PDS rotation key ($pds_key) is absent from rotationKeys"

  say "  and an operation signed with it is refused"
  cp "$SPEC" "$SPEC.orig"
  setfield "$SPEC" pdsEndpoint "http://pdsowned.localhost:$PDS_PORT"
  if identity apply --spec "$SPEC" --key-file "$IDENTITY_STATE/pds-rotation.key" >/dev/null 2>&1; then
    restore_spec
    fail "the PLC accepted an operation signed by a key that is not a rotation key"
  fi
  restore_spec
  rm -f "$IDENTITY_STATE/pds-rotation.key" "$SPEC.orig"
  identity plan --spec "$SPEC" >/dev/null || fail "the document changed despite the rejection"
  pass "the PLC rejects it and the document is unchanged"
}

case "${1:-all}" in
  drift) scenario_drift ;;
  recovery) scenario_recovery ;;
  pds-key-rejected) scenario_pds_key_rejected ;;
  all)
    scenario_drift
    scenario_recovery
    scenario_pds_key_rejected
    ;;
  *) fail "unknown scenario: $1 (drift|recovery|pds-key-rejected|all)" ;;
esac

say "identity scenarios passed"
