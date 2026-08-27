#!/usr/bin/env bash
# The destructive tests this harness exists for.
#
#   ./recovery.sh consumer-restart  # consumer dies mid-stream; does it converge?
#   ./recovery.sh cursor-rewind     # cursor deliberately rewound; same end state?
#   ./recovery.sh jetstream-outage  # measures what an upstream outage costs
#   ./recovery.sh all
#
# Each scenario compares the Firestore document BEFORE and AFTER the disruption,
# ignoring indexedAt (a wall-clock stamp written at index time, so it always
# differs on a replay and proves nothing). Convergence means: whatever the
# consumer did while it was confused, it ends up holding exactly the record the
# PDS holds.
#
# Requires: the stack up (./bootstrap.sh) and a Firestore emulator.
# This script owns the consumer process itself — do not run one alongside it,
# or two writers race for the same document.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

LOG=${LOG:-/tmp/maple-harness-consumer.log}
PIDFILE=${PIDFILE:-/tmp/maple-harness-consumer.pid}
# Marker so stop_consumer only ever kills consumers THIS script started, rather
# than any process on the machine whose command line mentions src/index.ts.
MARKER=MAPLE_HARNESS_CONSUMER=1

node22() {
  local n
  for n in "$HOME/.nvm/versions/node"/v2[2-9]*/bin/node; do
    [ -x "$n" ] && { echo "$n"; return; }
  done
  echo node
}
NODE=${NODE:-$(node22)}

start_consumer() {
  stop_consumer   # a second consumer on the same document invalidates everything
  : > "$LOG"
  # `exec` matters: without it $! is the wrapper subshell, and killing that
  # orphans node — which is exactly how two consumers end up racing.
  ( cd "$CONSUMER_DIR" && exec env "$MARKER" \
      JETSTREAM_URL="$JETSTREAM_URL" GCLOUD_PROJECT="$GCLOUD_PROJECT" \
      FIRESTORE_EMULATOR_HOST="$FIRESTORE_EMULATOR_HOST" \
      "$NODE" --import tsx src/index.ts >> "$LOG" 2>&1 ) &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 30); do
    grep -qE 'stored cursor|live tip' "$LOG" && break
    sleep 1
  done
  grep -qE 'stored cursor|live tip' "$LOG" || { cat "$LOG" >&2; fail "consumer did not start"; }
  # The consumer logs the cursor document it chose. Reading it back beats
  # re-deriving the host-keyed path here, which would silently diverge from
  # cursorDocPath() in the consumer the moment either side changed.
  CURSOR_DOC=$(sed -n 's/.*cursor=\([^ ]*\).*/\1/p' "$LOG" | head -1)
  [ -n "$CURSOR_DOC" ] || fail "consumer did not report its cursor document"
}

stop_consumer() {
  if [ -f "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    # SIGTERM, not SIGKILL: the consumer flushes its cursor on the way out, and
    # the rewind scenario needs that flushed value to exist.
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  pkill -f "$MARKER" 2>/dev/null || true
}
trap stop_consumer EXIT

seed() { "$HARNESS_DIR/seed.sh" >/dev/null; load_state; }

# The document as the consumer holds it, minus the index-time stamp.
doc_state() {
  fsget "atpJetstreamProfiles/$DID" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); raise SystemExit
f = d.get("fields", {})
f.pop("indexedAt", None)
print(json.dumps(f, sort_keys=True))
'
}

await_cid() { # await_cid <cid> <seconds>
  for _ in $(seq 1 "$2"); do
    doc_state | grep -q "$1" && return 0
    sleep 1
  done
  return 1
}

cursor_seq() {
  fsget "$CURSOR_DOC" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["fields"]["seq"]["integerValue"])' 2>/dev/null || echo ""
}

set_cursor_seq() { fspatch "$CURSOR_DOC" "{\"fields\":{\"seq\":{\"integerValue\":\"$1\"}}}"; }

await_cursor_at_least() { # await_cursor_at_least <seq> <seconds>
  local seq
  for _ in $(seq 1 "$2"); do
    seq=$(cursor_seq)
    [ -n "$seq" ] && [ "$seq" -ge "$1" ] 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

# Every scenario opens the same way: a running consumer, one fresh record it has
# demonstrably indexed, and a flushed cursor to disrupt.
baseline() {
  start_consumer
  seed
  await_cid "$CID" 60 || fail "baseline record never arrived; the harness is not healthy"
  # The cursor writer coalesces at 1s (cursor-store.ts), so wait for the write
  # rather than guessing at a sleep.
  await_cursor_at_least 0 10 || fail "the consumer never persisted a cursor"
  echo "baseline cid=$CID"
}

# The end state must equal the PDS's own view of the record — the source of
# truth for the whole pipeline.
assert_matches_pds() {
  local pds_cid
  pds_cid=$(curl -fsS "$PDS_URL/xrpc/com.atproto.repo.getRecord?repo=$DID&collection=app.bsky.actor.profile&rkey=self" | jqp cid)
  doc_state | grep -q "$pds_cid" || fail "consumer state does not match the PDS record ($pds_cid)"
  echo "end state matches the PDS record: $pds_cid"
}

# ─────────────────────────────────────────────────────────────────────────────
# The consumer dies mid-stream. This is the one that tests OUR code: the cursor
# is ours, the resume is ours, the idempotent write is ours.
consumer_restart() {
  say "consumer-restart: consumer dies mid-stream, restarts, must converge"
  baseline

  say "stopping the consumer, then writing two records behind its back"
  stop_consumer
  before=$(doc_state)
  seed; missed_one=$CID
  seed; missed_two=$CID
  echo "written while down: $missed_one then $missed_two"
  [ "$(doc_state)" = "$before" ] || fail "the document changed with no consumer running"

  say "restarting the consumer"
  start_consumer
  grep -q "resuming from stored cursor" "$LOG" || {
    tail -5 "$LOG" >&2
    fail "the consumer started from the live tip instead of its stored cursor — the gap is unrecoverable"
  }

  await_cid "$missed_two" 90 || {
    tail -20 "$LOG" >&2
    fail "the consumer never caught up to the records written while it was down"
  }

  assert_matches_pds
  stop_consumer
  pass "consumer resumed from its cursor and converged on the PDS's current record"
}

# ─────────────────────────────────────────────────────────────────────────────
cursor_rewind() {
  say "cursor-rewind: rewind the stored cursor, replay, end state must be identical"
  baseline

  before=$(doc_state)
  seq_before=$(cursor_seq)
  [ -n "$seq_before" ] || fail "no cursor document at $CURSOR_DOC — nothing to rewind"
  echo "cursor before rewind: seq=$seq_before"

  stop_consumer
  rewound=$(( seq_before > 3 ? seq_before - 3 : 0 ))
  say "rewinding the cursor to seq=$rewound and restarting the consumer"
  set_cursor_seq "$rewound"
  start_consumer

  # Replay is done once the consumer has climbed back to where it was.
  await_cursor_at_least "$seq_before" 30 \
    || fail "the consumer never replayed back up to seq=$seq_before"

  after=$(doc_state)
  [ "$after" = "$before" ] || {
    echo "before: $before" >&2
    echo "after:  $after" >&2
    fail "replaying from an older cursor changed the end state — writes are not idempotent"
  }
  echo "cursor after replay: seq=$(cursor_seq)"

  stop_consumer
  pass "replay from a rewound cursor reproduced the identical end state"
}

# ─────────────────────────────────────────────────────────────────────────────
# What a jetstream outage costs. The answer is "it depends", and the dependency
# is the point: jetstream persists its upstream relay cursor only when a segment
# block is durably flushed, so a restart resumes from the last flushed block
# rather than the last event it saw. Cold, that means it resubscribes at the
# live tail and the outage records are gone; after a flush, the relay replays
# the gap. Both were observed. See README.md, "A healthy consumer cursor is not
# evidence that nothing was missed" — including why this makes the parity
# checker load-bearing.
#
# What this scenario ASSERTS is the part that holds either way: the consumer
# survives, and lands on a coherent record — never a torn or invented one.
jetstream_outage() {
  say "jetstream-outage: measure what an upstream outage costs this consumer"
  baseline
  local baseline_cid=$CID

  say "stopping jetstream and writing a record while it is down"
  dc stop jetstream >/dev/null
  seed; missed=$CID
  echo "written during the outage: $missed"

  say "restarting jetstream"
  dc start jetstream >/dev/null
  wait_for jetstream "$JETSTREAM_DEBUG_URL/healthz" 60
  resumed_at=$(dc logs jetstream --since 90s 2>&1 | grep -o '"start_cursor":[0-9]*' | tail -1 | cut -d: -f2)
  echo "jetstream resubscribed to the relay at cursor ${resumed_at:-unknown}"

  kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null \
    || fail "the consumer died during the upstream outage"

  # A resume at 0 means it went back to the live tail, so the record is gone and
  # there is no point waiting the full budget for it.
  if [ "${resumed_at:-0}" = "0" ]; then budget=15; else budget=60; fi
  if await_cid "$missed" "$budget"; then
    assert_matches_pds
    stop_consumer
    pass "no data lost: jetstream resumed from a flushed cursor and the relay replayed the gap"
    return 0
  fi

  # The gap case. Assert we are sitting on the last good record, not on garbage.
  doc_state | grep -q "$baseline_cid" || fail "state is neither the missed record nor the baseline — this IS corruption"
  stop_consumer
  printf '\n\033[33mGAP (expected on a cold jetstream): the outage record never arrived.\033[0m\n'
  echo "  consumer holds the pre-outage record ($baseline_cid) and is internally consistent."
  echo "  the record written during the outage ($missed) is absent from the stream."
  echo "  jetstream had not flushed a block yet, so it resumed at the live tail."
  echo "  => this is the failure mode the parity checker has to catch."
}

case "${1:-all}" in
  consumer-restart) consumer_restart ;;
  cursor-rewind) cursor_rewind ;;
  jetstream-outage) jetstream_outage ;;
  all) consumer_restart; cursor_rewind; jetstream_outage ;;
  *) echo "usage: $0 [consumer-restart|cursor-rewind|jetstream-outage|all]" >&2; exit 2 ;;
esac
