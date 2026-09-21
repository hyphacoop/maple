# The local harness: design

How to run it is [README.md](README.md). This is what it is for, what it deliberately is not,
and the standing rules that keep it honest.

## Why it exists

The questions that actually matter about a firehose consumer — what happens when something dies
mid-stream, when a cursor is wrong, when the upstream skips — cannot be asked of a shared dev
environment, and cannot be asked of Bluesky's production network. They need a stack you are
allowed to break, so this is one: a real PDS, a real relay, a real jetstream and a real PLC, all
from pinned images, on your machine.

The cheap tier below it is the consumer's own `test/` directory, which drives synthetic events
straight into the indexer. That catches logic. This catches everything that is only true on the
wire.

## What it is not

**Nothing here is deployment-shaped.** No TLS, no real relay acceptance, no Cloud Run websocket
behaviour, no ADC, no Secret Manager. It buys debugging, not confidence about deployment, and a
local relay is not the relay a deployment will face — it must never be cited as evidence about
one.

## The seam rule

`services/atproto-consumer` runs here **unmodified**, pointed by environment alone:
`JETSTREAM_URL`, `GCLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, `MAPLE_DIDS`. If a change to
`src/` ever looks necessary to run locally, that is a finding about the seam, not an edit to
make. Nothing in the stack branches on "is local" either.

One consumer change did come out of this work, and it is the exception that proves the rule
because it is not an `if-local`: the cursor document is keyed by jetstream host, because a v2
cursor is a sequence number in one host's space and resuming a local run on a cursor the public
network wrote would replay from a meaningless offset. That is true everywhere, not just here.

## The finding that outranks the rest

**A healthy consumer cursor is not evidence that nothing was missed.** jetstream persists its
upstream relay cursor only when a segment block is durably flushed, so a restart resumes from the
last flushed block rather than the last event it saw. Both outcomes were observed here: from cold
it resubscribes at the live tail and everything emitted during an outage is skipped permanently;
after a flush it resubscribes at that cursor and the relay replays the gap.

The gap therefore opens upstream of us, silently, bounded by a flush cadence we do not control.
The consequence is a constraint on a component that does not exist yet: **gap detection must
compare against the PDS — the parity checker — and never against jetstream's own stream.** The
mechanism and the observed cursor values are in `recovery.sh`, above `jetstream_outage`.

## Not covered yet

Driving the cursor outside `--cursor-lookback` (36h), a sequence reset, and `ConsumerTooSlow`
backpressure. Each is a scenario `recovery.sh` could grow; none has been written because nothing
downstream depends on the answer yet.
