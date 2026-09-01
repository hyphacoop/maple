# atproto-consumer

Firehose consumer for MAPLE's atproto integration , built on
[Jetstream v2](https://atproto.com/blog/introducing-bluesky-protocol-services)
via the official `@bsky/jetstream` SDK.

It indexes `org.mapletestimony.*` records — bills and hearings — from a repo
into Firestore. The lexicons live at the repo root in `lexicons/`, and the
TypeScript schemas under `src/lexicons/` are generated from them (`yarn
codegen`) and committed.

Standalone node-22 ESM package, deliberately outside the root (CJS) toolchain
and excluded from the root `tsconfig.json`.

## What it does

- `Jetstream.runner(consumer).live()` against `JETSTREAM_URL` (a v2 host; the
  numbered `jetstream1.*`/`jetstream2.*` hosts speak legacy v1 — cursors are
  not portable between versions)
- schema-validated commits on `org.mapletestimony.bill` and
  `org.mapletestimony.hearing`:
  - `create`/`update` → upsert `atpBills/{court}-{billId}` and
    `atpHearings/hearing-{eventId}`. Idempotent, and updates rewrite the doc:
    bills are re-scraped daily, so the mappers need writes-on-update.
  - `delete` → the document is resolved by its stored `atp.uri` and removed.
    Not by record key: the rkey convention is the publisher's, and
    parsing it here would make a later rkey change a Firestore migration.
  - schema-invalid records are skipped and logged
- documents are written in the **app's own shape** (`functions/src/bills/types.ts`
  `Bill`, `functions/src/events/types.ts` `Hearing`) — PascalCase `content`,
  Firestore `Timestamp`s, explicit `null` for the app's nullable fields — so
  the cutover is a pointer change and not a re-mapping. Provenance
  (`did`/`uri`/`cid`/`seq`/`indexedAt`) sits in one nested `atp` key, which
  the parity checker can ignore wholesale.
- AppView-owned fields survive an indexed write: testimony counters and
  `latestTestimony*` on bills, video-transcription state on hearings, are
  carried across by `setPreserving` (`src/preserve.ts`), mirroring the bills
  scraper's `current?.testimonyCount ?? 0`.
- durable cursor: the runner's contiguous acked watermark is persisted to
  `atpJetstreamMeta/cursor-{host}` (`FirestoreCursorStore`), so a restart
  resumes where it left off with no gaps. The document is keyed by jetstream
  host because a v2 cursor is a seq in one host's sequence space.
- defaults to the emulator: if `FIRESTORE_EMULATOR_HOST` is unset it is set to
  `localhost:8080` unless `ALLOW_LIVE_FIRESTORE=true`, so an unset environment
  can't silently point at a real project

## Running it

Against the local e2e stack (`infra/atproto/`), which is the only place today
that emits `org.mapletestimony.*` records — nothing on the public network does.

Terminal 1 — Firestore emulator (from the repo root; UI at
http://localhost:3010):

```
yarn emulators:start
```

Terminal 2 — the stack, which prints the exact consumer command when it is up:

```
infra/atproto/bootstrap.sh
```

Terminal 3 — the consumer:

```
JETSTREAM_URL=http://localhost:6008 GCLOUD_PROJECT=demo-atp-local \
  MAPLE_DIDS=<the DID bootstrap.sh printed> \
  yarn --cwd services/atproto-consumer dev
```

Then, in terminal 4:

```
yarn --cwd services/atproto-consumer test:smoke
```

writes a bill and asserts it made the whole trip. It reads its endpoints from
`infra/atproto/endpoints.env`, so it takes no arguments and the identical
command runs against a local stack and in CI.

## Lexicons

`lexicons/org/mapletestimony/{bill,hearing}.json` are the source. After editing
either one:

```
yarn codegen    # regenerate src/lexicons/ (committed; CI diffs it)
yarn validate   # lexicon documents + the fixtures/ records
```

`fixtures/*.record.json` are the one definition of "a valid MAPLE record": the
validator checks them, the unit tests build synthetic events from them, and
`test/pds.ts` puts them on the local PDS.

## Tests

Synthetic Jetstream v2 events driven straight into the real `LexIndexer`
registration (`indexer.run()`, no websocket) against the Firestore emulator,
plus cursor-store and preserve unit tests — see `test/`. With an emulator
already up:

```
yarn test
```

or one-shot, spinning up its own emulator (what CI's `Consumer Checks` job
runs):

```
yarn test:emulated
```

These pin mapper semantics. They do **not** substitute for the e2e check
above: nothing here exercises transport, and a record that validates in
isolation can still be rejected by a real PDS.

`test/smoke.e2e.ts` is that e2e check. Its `.e2e.ts` suffix keeps it out of
`yarn test`'s `test/**/*.test.ts` glob on purpose — it needs a live PDS, relay
and jetstream, which the emulator-only job does not have. It asserts the same
document `indexer.test.ts` does, through `test/expected.ts`, so the real wire
path cannot drift from the unit expectation unnoticed. CI runs it in
`.github/workflows/atproto-harness.yml`.

`yarn seed` writes a record without asserting; `infra/atproto/recovery.sh` uses
it to seed while jetstream or the relay is deliberately stopped.

## Environment

| var                       | default                                    | meaning                                           |
| ------------------------- | ------------------------------------------ | ------------------------------------------------- |
| `JETSTREAM_URL`           | `https://jetstream.us-east.bsky.network`   | v2 jetstream host                                 |
| `GCLOUD_PROJECT`          | `demo-dtp`                                 | Firestore project id                              |
| `FIRESTORE_EMULATOR_HOST` | `localhost:8080` (forced unless opted out) | emulator target                                   |
| `ALLOW_LIVE_FIRESTORE`    | unset                                      | set `true` to allow a real Firestore target       |
| `MAPLE_DIDS`              | unset                                      | comma-separated repos to accept; unset = any repo |

`MAPLE_DIDS` unset means no DID filter, which is safe on the public network
because nothing there emits `org.mapletestimony.*`. It is not a no-op default
chosen for convenience: a filter that defaulted to matching _nothing_ would
make a misconfigured consumer indistinguishable from a healthy idle one.
Deployments pin it to MAPLE's own DID.
