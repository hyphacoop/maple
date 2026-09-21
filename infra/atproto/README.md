# Local atproto harness

    PDS -> relay -> jetstream -> services/atproto-consumer -> Firestore emulator

A containerised atproto stack you can break on purpose. It exists because the
questions that matter about a firehose consumer — what happens when something
dies mid-stream, when a cursor is wrong, when the upstream skips — cannot be
asked of a shared dev environment and cannot be asked of Bluesky's production
network. The cheap component-level tier is the consumer's own test harness,
`services/atproto-consumer/test`.

Nothing here is deployment-shaped. It buys **debugging**, not deployment: no
TLS, no real relay acceptance, no Cloud Run websocket behaviour, no ADC, no
Secret Manager. A local relay is not the relay a deployment will face and must never be
cited as evidence about one.

## Run it

    infra/atproto/bootstrap.sh          # up from cold, register the PDS, mint the identity, create the account

Then, from the repo root, in separate terminals:

    yarn --cwd services/atproto-consumer emulator

    JETSTREAM_URL=http://localhost:6008 GCLOUD_PROJECT=demo-atp-local \
      MAPLE_DIDS=<the DID bootstrap.sh printed> \
      yarn --cwd services/atproto-consumer dev

    yarn --cwd services/atproto-consumer test:smoke   # write a record, assert it arrives

`test:smoke` is the acceptance test. It reads its endpoints from
`endpoints.env`, so it takes no arguments and the identical command runs here
and in CI (`.github/workflows/atproto-harness.yml`) — CI just brings the stack
up with `bootstrap.sh` first.

The record is an `org.mapletestimony.bill` built from the consumer's own
fixture (`services/atproto-consumer/fixtures/bill.record.json`) with `fetchedAt`
stamped to now, so every seed has a distinct cid and the assertion matches on
it. An old document left over from a previous run cannot pass for a fresh
delivery.

Because seeding and asserting now happen in one process, the conventions are
imported rather than respelled: the collection, rkey and target document path
come from `src/records.ts` and the generated lexicons. `.harness-state` is
reduced to what a _shell_ still needs — the DID that `bootstrap.sh` writes, plus
the record keys `yarn seed` writes for `recovery.sh`.

Records are written after `bootstrap.sh`, not by it, and that ordering is
forced: a consumer with no cursor starts from the live tip, so it has to be
running before a record is put — and it cannot start without the DID.

To drive compose by hand, pass both env files — without them the stack has no
image references and no ports:

    docker compose --env-file infra/atproto/images.env \
      --env-file infra/atproto/endpoints.env -f infra/atproto/compose.yml ps

The consumer needs node >= 22.15; the repo root is pinned to node 20, so use a
node 22 on PATH for that terminal only.

|                    | port |                                            |
| ------------------ | ---- | ------------------------------------------ |
| PLC                | 2582 |                                            |
| PDS                | 2583 | `PDS_HOSTNAME=localhost`                   |
| relay              | 2470 | admin API + firehose; metrics on 2471      |
| jetstream          | 6008 | `/healthz`, `/readyz`, `/metrics` on 6060  |
| Firestore emulator | 8080 | on the host, not in the stack              |
| e2e emulators      | 8081 | `publish-check.sh` only; functions on 5011 |

Ports come from `endpoints.env`; change one there and compose and all four
scripts follow. Teardown, including all state, is that same compose invocation
with `down -v`.

## The publish loop

`test:smoke` proves the READ half, from a record it writes by hand. The write
half — the publisher in `services/atproto-publisher` — has its own check,
which needs no arguments and no running consumer:

    infra/atproto/publish-check.sh

It writes a bill document in the shape `functions/src/scraper.ts` actually
stores, then asserts it comes back around the whole loop:

    Firestore -> publishBill -> PDS -> relay -> jetstream -> consumer -> Firestore

and then asserts the property the publisher turns on: a re-scrape that moves only
`fetchedAt` must produce NO commit. The scraper rewrites every bill daily with
a fresh `fetchedAt`, so without that diff the publisher would put ~8000 no-op
commits a day on the firehose, each one minting a new cid and invalidating
every testimony strongRef pinned to the old one. That assertion is the reason
this script exists; a unit test cannot make it, because "nothing happened" is
only meaningful against the real pipeline.

Unlike the other scripts here it runs its OWN Firestore emulator, functions
emulator and consumer, on `firebase.atproto-e2e.json`'s ports, and tears all
three down on the way out. The functions emulator can only fire triggers against
a Firestore emulator it started itself, so it cannot reuse the one
`yarn --cwd services/atproto-consumer emulator` runs — which also means this
script coexists with a stack you already have up. It does need the compose stack
and an account, so `bootstrap.sh` first.

## Identity

`bootstrap.sh` does not let the PDS mint the DID. It mints one itself with
`services/atproto-identity` and then creates the account _with_ it -- the same
flow the network uses to migrate an account between PDSes. That is not local
convenience: it is the only way `rotationKeys` ends up as exactly
`[recovery, ops]`. A PDS that mints its own DID puts
`PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` into that list and can rewrite the
identity for good afterwards (ADR 0002 §1). Running the production sequence here
is what stops the runbook in `infra/gcp/README.md` describing something nobody
tests.

Per-run keys and the spec genesis writes a DID into live in
`.harness-identity/`, gitignored and thrown away by `down -v` for the same
reason the PDS volume is. The DID still lands in `.harness-state` exactly as
before, so `test:smoke`, `recovery.sh` and `publish-check.sh` need no knowledge
of any of this.

    infra/atproto/identity-check.sh          # drift, recovery, pds-key-rejected

**drift** -- the ops key changes the document out of band; `plan` must exit
non-zero. This is the scheduled drift alarm, rehearsed.

**recovery** -- the ops key signs a malicious endpoint change, then the recovery
key nullifies it. ADR 0002 §5 asks for this to be done once for real before
prod; running it on every CI run makes that a confirmation rather than a first
attempt. The 72-hour dispute window and the priority ordering are the local
PLC's, enforced identically to `plc.directory`.

**pds-key-rejected** -- the PDS's rotation key is absent from `rotationKeys`,
and an operation signed with it is refused.

### Findings

**`createAccount` with an existing DID lands the account deactivated, and a
deactivated account emits nothing.** That is the migration path behaving
normally -- create, import the old repo, then go live -- but it means the relay
never learns the repo exists until `com.atproto.server.activateAccount`. The
symptom is `EventsSeenSinceStartup: 0` on `/admin/pds/list` and an empty
`com.atproto.sync.listRepos`, with every read-path assertion failing on "the
relay does not know repo".

**`activateAccount` insists the PDS's own rotation key is in the document.**
`assertValidDocContents` (`api/com/atproto/server/util.js`) throws
`Server rotation key not included in PLC DID data` otherwise. So `identity
activate` borrows that key for the length of one call and removes it again,
leaving `rotationKeys` as the spec states it. The assertion is on no hot path --
its only callers are `activateAccount` and `checkAccountStatus`, which merely
reports `validDid` -- so the document stays serviceable afterwards.
`checkAccountStatus` reporting `validDid: false` from then on is expected.

Both of these are pinned-version behaviour, and `PDS_IMAGE` is pinned in
`images.env`. A bump that changes either fails this workflow before it reaches
dev, which is the reason the whole sequence runs in CI rather than being
written down.

## Destructive scenarios

    infra/atproto/recovery.sh consumer-restart
    infra/atproto/recovery.sh cursor-rewind
    infra/atproto/recovery.sh jetstream-outage
    infra/atproto/recovery.sh all

`recovery.sh` owns the consumer process itself — do not leave one running
alongside it, or two writers race for the same document and every assertion
becomes meaningless.

**consumer-restart** — the consumer dies mid-stream while records keep being
written, then restarts. It must resume from its stored cursor (not the live
tip), catch up on what it missed, and land exactly on the record the PDS holds.
This is the one that tests our own code: the cursor, the resume, the idempotent
write.

**cursor-rewind** — the stored cursor is rewound by hand and the consumer is
restarted, so it replays events it has already applied. The end state must be
byte-identical (ignoring `indexedAt`). Catches non-idempotent writes.

**jetstream-outage** — jetstream is stopped, a record is written, jetstream
comes back. See the finding below: the outcome legitimately varies, and the
scenario reports which one happened while asserting the consumer stays coherent
either way.

Others worth adding as they become relevant: driving the cursor outside
`--cursor-lookback` (36h), a sequence reset, `ConsumerTooSlow` backpressure.

## Findings

**A healthy consumer cursor is not evidence that nothing was missed.**
jetstream v0.2.1 persists its upstream relay cursor only from `onDurableBatch`
(`internal/ingest/live/consumer.go`) — when a segment block is durably flushed.
On restart it therefore resumes from the last _flushed block_, not the last
event it saw. Both outcomes were observed here:

- cold instance, nothing flushed yet: stored cursor `0`, it resubscribes at the
  live tail (`start_cursor:0`, relay logs `cursor:null`), and everything the
  relay emitted during the outage is skipped permanently on the livestream path;
- after a block has flushed: it resubscribes at that cursor (observed
  `start_cursor:20`) and the relay replays the gap.

The gap opens upstream of us, silently, bounded by a flush cadence we do not
control. Gap detection must compare against the PDS — the parity checker —
never against jetstream's own stream. This is the harness's first real result.

**requestCrawl cannot work against any local address.** The supported way to
attach a PDS to a relay is `com.atproto.sync.requestCrawl`. Its handler does
allow a `localhost:PORT` host, but only via the admin endpoint — and before
that, `relay.HostChecker.CheckHost` dials through `ssrf.PublicOnlyTransport`,
which rejects loopback and RFC1918 addresses _and_ every port that isn't 80 or 443. No local topology can satisfy that. `cmd/relay/HACKING.md` describes a
localhost exemption, and one does exist — in the slurper's websocket dialer
(`if !host.NoSSL`), not in the requestCrawl pre-flight.

So `bootstrap.sh` attempts the real call first (if upstream relaxes the check,
the harness starts using the production path with no edit) and otherwise writes
the same `host` row the handler would have written, then restarts the relay so
`ResubscribeAllHosts` picks it up. Everything after that — subscription,
validation, sequencing — is the relay's normal path.

**`PDS_HOSTNAME` must be the literal string `localhost`.** The PDS derives its
public URL from it (`http://localhost:${port}`, port defaulting to 2583) and
there is no override. Any other hostname bakes `https://` into the DID document,
after which anything that resolves the DID dials https and fails. Since the
relay and jetstream both resolve the DID and dial what it says, they must reach
the PDS on their own localhost — which is why every service shares one network
namespace via the `net` anchor. It also means `PDS_DEV_MODE=true` is required:
the PDS refuses to start when its OAuth resource URL is not https.

**Two of the four images are amd64-only** (indigo/relay and jetstream), so they
run emulated on an arm64 Mac. Local friction only — Cloud Run is amd64 native.

**The official PLC images stop at 2023-09.** The repo moved to the
`did-method-plc` org and the new org publishes nothing public, so PLC is built
from a pinned upstream commit. First `up` pays for that build once.

## Configuration

Two env files, read by `compose.yml` and by every script (through `lib.sh`), so
no boundary value is written down twice:

- `images.env` — image pins only. `infra/gcp/locals.tf` pins the same PDS tag
  for the deployed VM; the two are kept in lockstep by hand rather than by a
  `file()` read, which would tie that root's `validate` to this directory.
- `endpoints.env` — ports, project id, handle, and the local-only credentials.
  Those passwords are deliberately literal and in the repository; nothing here
  is used off this machine.

The scripts themselves are `bootstrap.sh` (up + register + create the account),
`recovery.sh` (the destructive scenarios), `publish-check.sh` (the publish loop,
above), and `lib.sh` — sourced, not run — which holds the compose invocation, the
emulator REST helpers and the wait loops they all share.

Seeding and asserting are TypeScript, in the consumer package:
`yarn --cwd services/atproto-consumer test:smoke` is the acceptance test, and
`yarn --cwd services/atproto-consumer seed` writes a record without asserting,
which is what `recovery.sh` drives while jetstream or the relay is deliberately
stopped. Both share one implementation (`test/pds.ts`), so there is one seeder
and one checker.

`GCLOUD_PROJECT` is `demo-atp-local`, deliberately not the `demo-dtp` the
consumer defaults to and the dev stack uses: a jetstream cursor is a seq in one
host's sequence space, so harness runs and dev runs must not share a cursor
document. Separate projects make that structural instead of something to
remember.

`services/atproto-consumer/` runs here **unmodified**, pointed by env alone:
`JETSTREAM_URL`, `GCLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, `MAPLE_DIDS`. If
a change to `src/` ever looks necessary to run locally, that is a finding about
the seam, not an edit to make.

One consumer change did come out of this work, and it is not an `if-local`: the
cursor document is keyed by jetstream host (`atpJetstreamMeta/cursor-<host>`),
via `cursorDocPath()` in `src/cursor-store.ts`. A v2 cursor is a seq in one
jetstream's sequence space; resuming a local run on a cursor the public network
wrote would replay from a meaningless offset. `recovery.sh` reads the chosen
path back out of the consumer's startup log rather than re-deriving it, so
there is one implementation of that rule.
