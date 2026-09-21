# Local atproto harness

    PDS -> relay -> jetstream -> services/atproto-consumer -> Firestore emulator

A containerised atproto stack you can break on purpose. What it is for, and what it deliberately
is not, is in [DESIGN.md](DESIGN.md).

## Run it

    infra/atproto/bootstrap.sh          # up from cold, register the PDS, mint the identity, create the account

Then, from the repo root, in separate terminals:

    yarn --cwd services/atproto-consumer emulator

    JETSTREAM_URL=http://localhost:6008 GCLOUD_PROJECT=demo-atp-local \
      MAPLE_DIDS=<the DID bootstrap.sh printed> \
      yarn --cwd services/atproto-consumer dev

    yarn --cwd services/atproto-consumer test:smoke   # write a record, assert it arrives

The consumer needs node >= 22.15 and the repo root is pinned to node 20, so put a node 22 on
PATH for that terminal only — `lib.sh` finds one for the scripts.

To drive compose by hand, pass both env files; without them the stack has no image references
and no ports:

    docker compose --env-file infra/atproto/images.env \
      --env-file infra/atproto/endpoints.env -f infra/atproto/compose.yml ps

Teardown, including all state, is that same invocation with `down -v`.

|                    | port |                                            |
| ------------------ | ---- | ------------------------------------------ |
| PLC                | 2582 |                                            |
| PDS                | 2583 | `PDS_HOSTNAME=localhost`                   |
| relay              | 2470 | admin API + firehose; metrics on 2471      |
| jetstream          | 6008 | `/healthz`, `/readyz`, `/metrics` on 6060  |
| Firestore emulator | 8080 | on the host, not in the stack              |
| e2e emulators      | 8081 | `publish-check.sh` only; functions on 5011 |

Ports come from `endpoints.env`; change one there and compose and every script follow.

## The other checks

`test:smoke` proves the read half, from a record it writes by hand. The rest each run standalone
after `bootstrap.sh`:

    infra/atproto/publish-check.sh           # the write half: scraped doc -> PDS -> back to Firestore
    infra/atproto/identity-check.sh          # drift, recovery, pds-key-rejected
    infra/atproto/recovery.sh consumer-restart
    infra/atproto/recovery.sh cursor-rewind
    infra/atproto/recovery.sh jetstream-outage
    infra/atproto/recovery.sh all

`publish-check.sh` runs its own emulators on 8081/5011, so it coexists with a stack already up.
`recovery.sh` owns the consumer process itself — do not leave one running alongside it, or two
writers race for the same document and every assertion becomes meaningless.

## What is in here

`compose.yml` is the stack; `images.env` holds every image pin and `endpoints.env` every port,
project id and local-only credential. The scripts are `bootstrap.sh`, `recovery.sh`,
`publish-check.sh` and `identity-check.sh`, over `lib.sh` — sourced, not run — which holds the
compose invocation, the emulator REST helpers and the wait loops they share.

Nothing here costs anything: it is docker on your machine, talking to no cloud project.
