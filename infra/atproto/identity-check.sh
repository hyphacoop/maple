#!/usr/bin/env bash
# The custody scenarios from ADR 0002, run against the harness's real PLC.
#
#   ./identity-check.sh [drift|recovery|pds-key-rejected|all]
#
# These are the assertions that cannot be made anywhere else. The local PLC is
# the did-method-plc server built from the pinned commit in images.env -- the
# same code plc.directory runs -- so the 72-hour dispute window, the rotation
# key priority order and the signature checks all behave identically here.
# Nothing in this script touches plc.directory.
#
# bootstrap.sh first: this asserts against the identity it minted.
#
# It mutates the live document on purpose and puts it back. Every scenario ends
# with `plan` clean, and the script fails loudly if it does not -- a harness left
# in a drifted state would make every later run lie.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

SPEC="$IDENTITY_STATE/spec.json"
[ -f "$SPEC" ] || fail "no $SPEC -- run ./bootstrap.sh first"
load_state DID

setfield() {
  python3 -c '
import json,sys
p,k,v = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(p)); d[k] = v
json.dump(d, open(p,"w"), indent=2)
' "$1" "$2" "$3"
}

# The canonical log, and what has been nullified out of it, exactly as
# @atcute/did-plc's processIndexedEntryLog derives them.
audit() {
  curl -fsS "$PLC_URL/$DID/log/audit" | python3 -c '
import json,sys
log = json.load(sys.stdin)
live = [e for e in log if not e["nullified"]]
dead = [e for e in log if e["nullified"]]
print(f"{len(log)} operations, {len(live)} canonical, {len(dead)} nullified")
'
}

restore_spec() { cp "$SPEC.orig" "$SPEC"; }

scenario_drift() {
  say "drift: an out-of-band change makes plan fail"
  # The compromise this models is the ops key, not the VM: the VM cannot sign a
  # PLC operation at all (its key is not in rotationKeys), which is scenario
  # pds-key-rejected below.
  cp "$SPEC" "$SPEC.orig"
  setfield "$SPEC" pdsEndpoint "http://drifted.localhost:$PDS_PORT"
  identity apply --spec "$SPEC" --key-file "$IDENTITY_STATE/ops.key" >/dev/null

  restore_spec
  if identity plan --spec "$SPEC" >/dev/null 2>&1; then
    fail "plan reported no drift after the document was changed out of band"
  fi
  pass "plan exits non-zero on drift"

  say "putting it back with the ops key"
  identity apply --spec "$SPEC" --key-file "$IDENTITY_STATE/ops.key" >/dev/null
  identity plan --spec "$SPEC" >/dev/null || fail "plan still reports drift after repair"
  pass "plan is clean again"
  rm -f "$SPEC.orig"
}

scenario_recovery() {
  say "recovery: the recovery key nullifies an operation the ops key signed"
  # ADR 0002 §5 asks for this to be rehearsed once against plc.directory before
  # prod. Running it continuously here is what makes that a confirmation rather
  # than a first attempt.
  cp "$SPEC" "$SPEC.orig"

  say "  the ops key is compromised and moves the PDS endpoint"
  setfield "$SPEC" pdsEndpoint "http://attacker.localhost:$PDS_PORT"
  identity apply --spec "$SPEC" --key-file "$IDENTITY_STATE/ops.key" >/dev/null
  before=$(audit)
  echo "  $before"

  say "  the recovery key overrides it"
  restore_spec
  identity nullify --spec "$SPEC" --key-file "$IDENTITY_STATE/recovery.key" >/dev/null

  after=$(audit)
  echo "  $after"
  case "$after" in
    *" 0 nullified"*) fail "nothing was nullified: the override did not take" ;;
  esac

  identity plan --spec "$SPEC" >/dev/null || fail "the document did not revert to the spec"
  pass "the malicious operation is nullified and the document matches the spec"
  rm -f "$SPEC.orig"
}

scenario_pds_key_rejected() {
  say "the PDS's rotation key is not in the document, and cannot sign for it"
  # The PDS holds PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX and would have put
  # it in rotationKeys had it minted this DID. It did not, so the key is inert
  # for this identity -- that is the single property the whole bring-your-own-DID
  # flow buys, and it is worth asserting rather than assuming.
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
