# atproto-consumer: design

How to run it is [README.md](README.md). This is why it is shaped the way it is. The local stack
it is exercised against has its own [DESIGN.md](../../infra/atproto/DESIGN.md).

## Documents are keyed by the app's shape, not by record key

A record arriving from the firehose becomes a document whose id and field names are the ones the
app already uses, not the ones atproto uses. Keying by rkey would have been the obvious route and
is the trap: the rkey convention belongs to the publisher, so a publisher-side rename would
become a Firestore migration, and the cutover — pointing the app at these collections — would be
a re-mapping rather than a pointer change. Because the shapes match, it is a pointer change.

## Shadow collections, and what preserves what

The consumer writes `atpBills`/`atpHearings`, never the live collections. That is what makes the
whole pipeline safe to run in production before anyone has decided to trust it: the parity
checker can compare the two, and a wrong answer costs nothing.

Some fields on those documents are owned by the appview rather than by the record — things the
firehose has no opinion about. A whole-document write would erase them on every update, so writes
preserve them explicitly. That is also why a document mapped from a record carries `undefined`
for fields the event omits, and why `ignoreUndefinedProperties` is on: the alternative is a
per-field guard at every call site, which decays.

## The cursor is per jetstream host

A v2 cursor is a sequence number in one jetstream's space. Resuming against a different host with
a cursor the first one wrote replays from a meaningless offset, so the cursor document is keyed by
host. This is the one consumer change that came out of building the local harness, and it is not
an `if-local`: it is true of any two hosts, including two public ones.

## `MAPLE_DIDS` defaults to no filter

Unset means "accept any repo", which is safe on the public network because nothing else emits
`org.mapletestimony.*`. The alternative default — matching nothing — is worse than it looks: a
misconfigured consumer would then be indistinguishable from a healthy idle one, silently indexing
nothing while every dashboard stayed green. Deployments pin it to MAPLE's own DID.

## Why it is outside the root toolchain

Its own package, its own lockfile, node 22 ESM, excluded from the root tsconfig. The root is CJS
on node 20 and the consumer needs neither; keeping it separate means it can take the SDK versions
it needs without negotiating with the frontend's dependency tree. The cost is that root
`check-types` cannot see it, which is why CI runs a typecheck job of its own.
