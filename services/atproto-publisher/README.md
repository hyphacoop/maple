# atproto-publisher

Mirrors scraped bills and hearings onto MAPLE's PDS as `org.mapletestimony.*` records. Unlike the
consumer it is not a standalone service: it deploys into Firebase as its own functions codebase,
`maple-atproto`.

## What deploys, and when it runs

Two triggers, both `onDocumentWritten`, both `retry: false`:

| function         | document path                              | record                       |
| ---------------- | ------------------------------------------ | ---------------------------- |
| `publishBill`    | `/generalCourts/{court}/bills/{billId}`    | `org.mapletestimony.bill`    |
| `publishHearing` | `/events/{eventId}` (only `type: hearing`) | `org.mapletestimony.hearing` |

No schedules, no HTTP endpoints. Deletes are ignored on purpose: the PDS record stands. Because
the scraper rewrites every bill daily, expect ~8000 invocations a day of which almost all are
no-ops — `publish.ts` hashes the record with `fetchedAt` excluded, so an unchanged bill produces
no commit. `retry: false` means a publish lost to a PDS outage stays lost until the next scrape
or a backfill, which is the deliberate trade against redelivering thousands of events.

## Configuration

`ATP_PDS_URL`, `ATP_PDS_HANDLE` (plain env) and `ATP_PDS_PASSWORD` (Secret Manager, created by
`infra/gcp`). **All three or nothing**: with any one missing the triggers no-op and log, once per
instance,

    atproto publisher is not configured (ATP_PDS_URL / ATP_PDS_HANDLE / ATP_PDS_PASSWORD); publishing is disabled

That is the first thing to check when nothing is publishing, because silence is also what a
healthy steady state looks like.

**Nothing in this repository sets `ATP_PDS_URL` or `ATP_PDS_HANDLE` at deploy time** — they are
set only by the local harness. As the tree stands, a deployed `maple-atproto` stays in the no-op
path until someone sets them by hand.

## Deploying

`deploy-backend-dev.yml`, on push to `main`, path-filtered to `services/atproto-publisher/**`.
Dev only; there is no prod path in the repo. `firebase.json` declares the codebase and its
predeploy install + build.

## Is it working?

- Cloud Logging for `maple-atproto`: `published bill …` / `published hearing …` carry the cid.
  `unchanged` is logged at debug, so a healthy quiet day looks like nothing at all.
- `atpPublished/{nsid}_{rkey}` — one document per published record, with `did`, `hash`, `uri`,
  `cid`, `publishedAt`. **It is a mirror, not an authority**: point the publisher at a rebuilt
  repo and every hash still matches, so nothing republishes. The backfill closes that gap by
  listing the repo first.
- End to end, the consumer's `atpBills`/`atpHearings` carrying an `atp.cid` proves the whole loop,
  not just this half.

## By hand

    yarn --cwd services/atproto-publisher backfill [bill|hearing]   # whole corpus; needs all three vars
    yarn --cwd services/atproto-publisher validate                  # every lexicon has a publisher target
    infra/atproto/publish-check.sh                                  # the local end-to-end driver

`backfill` is not a function: 8000 bills do not fit in the 540s ceiling. It pages Firestore,
batches PDS writes, honours `Retry-After` on 429, and shares the change detection with the
triggers, so a second run is cheap.

## Cost

No infrastructure of its own. It bills as Cloud Functions invocations against the existing
Firebase project — roughly 8000 trigger fires a day, nearly all of them returning without a PDS
call — plus one Secret Manager access per cold instance. The content hash is what keeps that
from becoming 8000 PDS commits and their firehose traffic.
