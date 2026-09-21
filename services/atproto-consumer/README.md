# atproto-consumer

Jetstream v2 firehose consumer: indexes `org.mapletestimony.*` records into Firestore. A
standalone node-22 ESM package, outside the root CJS toolchain. Why it is built this way:
[DESIGN.md](DESIGN.md).

## Running it

Against the local harness ([`infra/atproto/`](../../infra/atproto/README.md)), which is the only
place today that emits `org.mapletestimony.*` records — nothing on the public network does.

```
yarn emulators:start                    # 1. Firestore emulator, from the repo root (UI :3010)
infra/atproto/bootstrap.sh              # 2. the stack; prints the consumer command when up
```

```
JETSTREAM_URL=http://localhost:6008 GCLOUD_PROJECT=demo-atp-local \
  MAPLE_DIDS=<the DID bootstrap.sh printed> \
  yarn --cwd services/atproto-consumer dev
```

```
yarn --cwd services/atproto-consumer test:smoke     # write a bill, assert the whole trip
```

`test:smoke` reads its endpoints from `infra/atproto/endpoints.env`, so it takes no arguments and
the identical command runs locally and in CI.

Deployed, it is the gated Cloud Run service in [`infra/gcp`](../../infra/gcp/README.md), which is
also where its cost lives.

## Lexicons

`lexicons/org/mapletestimony/{bill,hearing}.json` are the source. After editing either:

```
yarn codegen    # regenerate src/lexicons/ (committed; CI diffs it)
yarn validate   # lexicon documents + the fixtures/ records
```

`fixtures/*.record.json` are the one definition of "a valid MAPLE record": the validator checks
them, the unit tests build synthetic events from them, and `test/pds.ts` puts them on a real PDS.

## Tests

```
yarn test           # unit, needs an emulator already up
yarn test:emulated  # the same, starting its own
```

Neither substitutes for `test:smoke` above: they drive synthetic events straight into the
indexer, so they cannot fail on anything that is only true on the wire. `yarn seed` writes a
record without asserting anything, which is what `recovery.sh` drives while jetstream or the
relay is deliberately stopped.

## Environment

| var                       | default                                    | meaning                                           |
| ------------------------- | ------------------------------------------ | ------------------------------------------------- |
| `JETSTREAM_URL`           | `https://jetstream.us-east.bsky.network`   | v2 jetstream host                                 |
| `GCLOUD_PROJECT`          | `demo-dtp`                                 | Firestore project id                              |
| `FIRESTORE_EMULATOR_HOST` | `localhost:8080` (forced unless opted out) | emulator target                                   |
| `ALLOW_LIVE_FIRESTORE`    | unset                                      | set `true` to allow a real Firestore target       |
| `MAPLE_DIDS`              | unset                                      | comma-separated repos to accept; unset = any repo |

The emulator default is a safety catch rather than a convenience: an unconfigured consumer writes
to an emulator that is not running, instead of to live Firestore.
