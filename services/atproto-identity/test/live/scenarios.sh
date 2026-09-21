# shellcheck shell=bash
# The custody scenarios from ADR 0002 that need a real PLC directory.
#
# SOURCE this, do not run it. The caller owns the PLC and the identity it
# asserts against; this file owns what the assertions are, so there is exactly
# one statement of each scenario however many rigs end up driving them.
#
# The caller must provide:
#
#   identity   the CLI, invoked so that `--import tsx` resolves (a function)
#   say pass fail   progress, success and abort
#   PLC_URL    the directory these operations go to
#   SPEC       the spec file, already through genesis
#   DID        what genesis minted
#   OPS_KEY RECOVERY_KEY   key files, in that priority order
#
# Every scenario mutates the live document on purpose and puts it back, and
# ends with `plan` clean -- an identity left drifted would make every later run
# lie.

: "${DRIFT_ENDPOINT:=http://drifted.localhost:2583}"
: "${ATTACKER_ENDPOINT:=http://attacker.localhost:2583}"

for _required in PLC_URL SPEC DID OPS_KEY RECOVERY_KEY; do
  [ -n "${!_required:-}" ] || fail "scenarios.sh needs $_required"
done
unset _required

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
  # The compromise this models is the ops key, not a server holding a signing
  # key: such a server cannot sign a PLC operation at all, its key not being in
  # rotationKeys.
  cp "$SPEC" "$SPEC.orig"
  setfield "$SPEC" pdsEndpoint "$DRIFT_ENDPOINT"
  identity apply --spec "$SPEC" --key-file "$OPS_KEY" >/dev/null

  restore_spec
  if identity plan --spec "$SPEC" >/dev/null 2>&1; then
    fail "plan reported no drift after the document was changed out of band"
  fi
  pass "plan exits non-zero on drift"

  say "putting it back with the ops key"
  identity apply --spec "$SPEC" --key-file "$OPS_KEY" >/dev/null
  identity plan --spec "$SPEC" >/dev/null || fail "plan still reports drift after repair"
  pass "plan is clean again"
  rm -f "$SPEC.orig"
}

scenario_recovery() {
  say "recovery: the recovery key nullifies an operation the ops key signed"
  # ADR 0002 asks for this to be rehearsed once against plc.directory before
  # prod. Running it continuously here is what makes that a confirmation rather
  # than a first attempt.
  cp "$SPEC" "$SPEC.orig"

  say "  the ops key is compromised and moves the PDS endpoint"
  setfield "$SPEC" pdsEndpoint "$ATTACKER_ENDPOINT"
  identity apply --spec "$SPEC" --key-file "$OPS_KEY" >/dev/null
  before=$(audit)
  echo "  $before"

  say "  the recovery key overrides it"
  restore_spec
  identity nullify --spec "$SPEC" --key-file "$RECOVERY_KEY" >/dev/null

  after=$(audit)
  echo "  $after"
  case "$after" in
    *" 0 nullified"*) fail "nothing was nullified: the override did not take" ;;
  esac

  identity plan --spec "$SPEC" >/dev/null || fail "the document did not revert to the spec"
  pass "the malicious operation is nullified and the document matches the spec"
  rm -f "$SPEC.orig"
}
