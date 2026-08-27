# atproto-consumer

Firehose consumer for MAPLE's atproto integration , built on
[Jetstream v2](https://atproto.com/blog/introducing-bluesky-protocol-services)
via the official `@bsky/jetstream` SDK.

This first slice tails the **public** Bluesky-operated jetstream and indexes
profiles (`app.bsky.actor.profile`) into a local Firestore emulator — a real
end-to-end pipe over the real network. Swapping it to MAPLE records later
means changing the mapper (`src/mapper.ts`) and the indexer registration in
`src/indexer.ts` (to `org.mapletestimony.*` + a `dids` filter), not the
architecture.

Standalone node-22 ESM package, deliberately outside the root (CJS) toolchain
and excluded from the root `tsconfig.json`.

## What it does

- `Jetstream.runner(LexIndexer).live()` against
  `https://jetstream.us-east.bsky.network` (the v2 host; the numbered
  `jetstream1.*`/`jetstream2.*` hosts speak legacy v1 — cursors are not
  portable between versions)
- schema-validated `app.bsky.actor.profile` commits:
  - `create`/`update` → upsert `atpJetstreamProfiles/{did}` (idempotent: doc
    id = DID; updates rewrite the doc — bills are re-scraped daily, so the
    maple mappers need writes-on-update, and this pins those semantics).
    Profile docs are wholly consumer-owned, so puts are a plain set; when the
    maple mappers land, collections with appview-owned fields (testimony
    counters, …) write through `setPreserving` (`src/preserve.ts`), which
    mirrors the bills scraper's counter preservation
  - `delete` → doc removed
  - schema-invalid records are skipped and logged
- durable cursor: the runner's contiguous acked watermark is persisted to
  `atpJetstreamMeta/cursor` (`FirestoreCursorStore`), so a restart resumes
  where it left off with no gaps
- defaults to the emulator: if `FIRESTORE_EMULATOR_HOST` is unset it is set to
  `localhost:8080` unless `ALLOW_LIVE_FIRESTORE=true`, so an unset environment
  can't silently point at a real project

## Running it

Terminal 1 — Firestore emulator (from the repo root; UI at
http://localhost:3010):

```
yarn emulators:start
```

(or just Firestore: `npx firebase --project demo-dtp emulators:start --only firestore`)

Terminal 2 — the consumer:

```
cd services/atproto-consumer
yarn
yarn dev
```

Within a minute you should see `indexed new profile did:plc:…` lines and docs
accruing in `atpJetstreamProfiles`. Kill it (ctrl-c) and restart: it logs
`resuming from stored cursor seq=…` and replays the gap; DID-keyed upserts
keep the collection duplicate-free.

## Tests

Synthetic Jetstream v2 events driven straight into the real `LexIndexer`
registration (`indexer.run()`, no websocket) against the Firestore emulator,
plus cursor-store unit tests — see `test/`. With an emulator already up:

```
yarn test
```

or one-shot, spinning up its own emulator (what CI's `Consumer Checks` job
runs):

```
yarn test:emulated
```

## Environment

| var                       | default                                    | meaning                                     |
| ------------------------- | ------------------------------------------ | ------------------------------------------- |
| `JETSTREAM_URL`           | `https://jetstream.us-east.bsky.network`   | v2 jetstream host                           |
| `GCLOUD_PROJECT`          | `demo-dtp`                                 | Firestore project id                        |
| `FIRESTORE_EMULATOR_HOST` | `localhost:8080` (forced unless opted out) | emulator target                             |
| `ALLOW_LIVE_FIRESTORE`    | unset                                      | set `true` to allow a real Firestore target |
