# ATProto spike — findings

**Audience:** MAPLE maintainers with no ATProto background. This is the consolidated
deliverable of the ATProto spike (epic #58); the raw per-issue log lives in
[`atproto-spike-notes.md`](./atproto-spike-notes.md).

**TL;DR:** We ran MAPLE's core loop — browse bills, sign in, publish testimony, read
everyone else's testimony — entirely on ATProto, locally, with users writing testimony
into repositories they own. The loop works, and the data-ownership win is real: a user's
testimony lives in _their_ repo, portable and cryptographically theirs, and our
one-testimony-per-bill rule falls out of the protocol for free. But MAPLE's read side
(counts, listings, pagination, search, author names, moderation) has no protocol-level
home: all of it requires building and operating an **AppView** — an always-on indexing
service that is effectively most of MAPLE's current backend rebuilt on a firehose.
Production adoption also requires an OAuth stack and a node ≥22 / ESM toolchain
migration before the first line of feature code. **Recommendation: no-go as a near-term
Firestore replacement; conditional go as a strategic direction** — see
[§7](#7-gono-go-recommendation).

---

## 1. What the spike was

Goal (epic #58): discover the _problems_ with running MAPLE's core loop on ATProto —
not ship code. Happy-path only, no security rules, no i18n beyond reuse, timeboxed.

What was built (all on the `atp-spike` branch, parallel to the Firebase app, which is
untouched):

- A throwaway local ATProto network (`yarn atp:dev`) and seed script (`yarn atp:seed`).
- Lexicon schemas for two record types: `org.mapletestimony.bill` and
  `org.mapletestimony.testimony`, with mappers to/from MAPLE's existing `Bill` and
  `Testimony` types.
- A second auth provider (`/atp/login`, handle + password against the local PDS)
  mounted alongside Firebase auth.
- Bill list + detail pages (`/atp/bills`, `/atp/bills/[court]/[billId]`) rendered from
  ATProto records, reusing MAPLE's presentational components.
- A testimony panel that writes into the _signed-in user's own_ repository, and a
  cross-user listing that scans every repository on the PDS to show all testimony on a
  bill with real position counts.

Acceptance criteria 1–5 of the epic were all verified live in the browser. The stretch
goal (#66, a firehose-fed micro-appview) was deliberately skipped — the fan-out
measurements in [§5.2](#52-there-is-no-cross-repo-query) already told us what it would
have confirmed.

## 2. ATProto in five minutes (for a Firestore-shaped brain)

- **DID** — a permanent user id (`did:plc:abc123…`). The ATProto analog of a Firebase
  `uid`, except it's globally resolvable and the user can move providers without
  changing it.
- **Handle** — a human-readable name (`alice.test`, or a domain like
  `mapletestimony.org`) that resolves to a DID via DNS/HTTPS. Handles can change;
  DIDs cannot.
- **PDS (Personal Data Server)** — the server hosting a user's data. Think "each user
  gets their own tiny Firestore that they can take with them to another host."
- **Repo / records / collections / rkey** — each user's PDS hosts a signed Merkle-tree
  _repository_ of JSON _records_, grouped into _collections_ named by schema id
  (`org.mapletestimony.testimony`), each keyed by an _rkey_ (a short string we choose).
  Records are **public by definition** — there is no private read rule.
- **Lexicon** — the schema language. A lexicon defines a record type's shape, like a
  Firestore converter + validation rules, except (surprise ahead in
  [§5.8](#58-schema-enforcement-is-client-side-only)) mostly nobody enforces it for you.
- **strongRef** — a record-to-record link carrying both a `uri` (which record) and a
  `cid` (a content hash of _which version_ of it).
- **Firehose** — every PDS emits a real-time event stream of every record change in
  every repo it hosts. This is the only scalable way to observe other users' writes.
- **AppView** — a service _you build_ that consumes the firehose and maintains a
  queryable index. Everything Firestore gives you across users — queries, counts,
  ordering, pagination — lives here or nowhere. Bluesky-the-app is mostly its AppView.
- **Relay** — infrastructure that aggregates many PDSes' firehoses into one stream, so
  an AppView doesn't need to know every PDS in the world.

The one-sentence mental model: **ATProto gives each user a portable, public,
self-owned write store, and makes every cross-user read your problem.**

## 3. End-to-end demo script

Prerequisites: repo checked out on `atp-spike`, node 20 (`nvm use`), `yarn install`.
Three terminals.

1. **Boot the local ATProto network** (terminal 1):

   ```
   yarn atp:dev
   ```

   Prints the PDS URL (`http://localhost:2583`) and a curl smoke check. Everything
   lives in your OS temp dir and is discarded on Ctrl+C.

2. **Seed it** (terminal 2, network running):

   ```
   yarn atp:seed
   ```

   Creates three accounts — `maple.test`, `alice.test`, `bob.test` (passwords
   `maple-pass`, `alice-pass`, `bob-pass`) — publishes four real 194th-court MA bills
   (H.72, S.25, H.1234, H.2246) into the maple repo, and one bob testimony on H.1234
   into _bob's_ repo. It ends by printing an env block:

   ```
   NEXT_PUBLIC_ATP_PDS_URL=http://localhost:2583
   NEXT_PUBLIC_MAPLE_DID=did:plc:…
   ```

   Copy both lines into `.env.local`. Re-running the seed is safe (pure upsert).

3. **Start the app** (terminal 3):

   ```
   yarn dev
   ```

4. **Browse bills from ATProto:** open <http://localhost:3000/atp/bills> — the four
   seeded bills render as a card list. Click **H.1234** (or go to
   `/atp/bills/194/H1234`): bill number, status + history, summary, sponsors, and
   committee render from the ATProto record via MAPLE's own presentational components.
   Bob's seeded testimony is already listed with real position counts (1 endorse) —
   no sign-in required for any of this.

5. **Sign in as alice:** go to <http://localhost:3000/atp/login>, enter `alice.test` /
   `alice-pass`. The page shows her handle and DID. This is a second, independent
   session — the Firebase navbar still shows "Log in / Sign up" (see
   [§5.9](#59-sessions-and-identity-lifecycle-have-sharp-edges)).

6. **Publish testimony:** back on `/atp/bills/194/H1234`, the "Your Testimony (ATProto)" panel
   is now a form. Pick a position, write some text, Publish. The success message shows the
   record's `uri` and `cid` — the record was written into **alice's** repo, not
   MAPLE's.

7. **See the cross-user listing:** reload the page. Alice's and bob's testimony are both
   listed (newest first) and the header counts update (e.g. 1 endorse / 1 oppose). Edit
   your testimony and republish: the same record is overwritten in place — the button
   says Update, the `uri` is stable, the `cid` changes, and there is still exactly one
   record (one testimony per bill per user, enforced by construction).

Two routine dev-loop gotchas, both consequences of the network being throwaway:

- **Every `atp:dev` restart mints a new maple DID.** Re-run `yarn atp:seed`, update
  `NEXT_PUBLIC_MAPLE_DID` in `.env.local`, and restart `yarn dev` (`NEXT_PUBLIC_*` vars
  are inlined at boot). The bill pages show a setup alert rather than a 404 when the
  DID is unset/stale, because this failure mode is routine.
- **Browser sessions don't survive a restart.** A session from a previous network
  instance can resume as _apparently signed in_ on a DID that no longer exists (the
  panel then shows a load error). Clear the `maple.atproto.session` localStorage key
  and sign in again. Details in [§5.9](#59-sessions-and-identity-lifecycle-have-sharp-edges).

## 4. What mapped cleanly (the wins)

- **One testimony per bill per user became a free invariant.** Testimony rkey is
  `${court}-${billId}` in the author's repo, so a second submission _is_ an edit
  (`putRecord` upsert). MAPLE enforces this today with transaction logic; ATProto
  enforces it by construction.
- **Edit-in-place is observable and honest.** Same `uri`, new `cid`, stable
  `createdAt` — an overwrite is provable from the record alone.
- **Testimony provably pins the bill version the author saw.** The record carries a
  strongRef whose `cid` is the content hash of the exact bill snapshot at submit time —
  a small integrity win Firestore doesn't give us.
- **Users genuinely own their testimony.** It lives in their repo, signed, portable to
  another PDS, and readable by anyone without MAPLE's cooperation. This is the point of
  the exercise, and it works.
- **Dual-auth coexistence was clean at the infrastructure level.** The ATProto provider
  (React context + one localStorage key) mounts alongside Firebase auth with zero shared
  state and zero interference. (The _UX_ of two sessions is another story — §5.9.)
- **MAPLE's presentational components largely survived.** The bill detail page is
  recomposed from existing children (BillNumber, Status, Summary, Sponsors, Committees)
  and the cross-user listing reuses `ViewTestimony` untouched — the Firebase coupling
  is real but shallower than feared, mostly living in container components.
- **The local dev environment is genuinely good.** `TestNetworkNoAppView` boots an
  in-process PLC + PDS on SQLite in seconds, no docker, no postgres, no jest.

## 5. The hard problems

Consolidated thematically from the per-issue "Problems discovered" notes; the issue
numbers in parentheses point into [`atproto-spike-notes.md`](./atproto-spike-notes.md).

### 5.1 Counters and aggregates become read-time aggregation

Firestore MAPLE stores `testimonyCount` / `endorseCount` / `opposeCount` /
`neutralCount` / `latestTestimony*` _on the bill document_, updated transactionally at
publish time. In ATProto these are aggregates over **other users' repos** — no record
anyone owns can hold them. They were dropped from the bill lexicon, rendered as 0 on the
first bill pages, and only became real when #65's fan-out computed them at read time
by scanning every repo. Every cross-user number MAPLE renders must be computed by an
AppView consuming the firehose (or recomputed on every page view, which doesn't scale —
next section). This is the single biggest architectural inversion. (#60, #63, #65)

### 5.2 There is no cross-repo query

The protocol has no "give me all `org.mapletestimony.testimony` records for bill X
across users" primitive. The spike's listing is a fan-out: `listRepos` → per-repo
`describeRepo` → per-repo `listRecords`, i.e. **O(every account on the PDS)** per bill
page, not O(bill participants). Measured live: 3 repos → 9 requests / ~70 ms; 15 repos
→ 45 requests / 167 ms. Linear growth, and every visitor pays it for every repo
including ones with zero testimony.

Consequences:

- **Pagination without an AppView is theater.** Page 2 and the header counts both need
  the complete fan-out result; the spike paginates by slicing a cached in-memory array.
  Real pagination, freshness, and search all require a maintained index.
- `com.atproto.sync.listReposByCollection` (which would narrow the walk) is typed in
  the API but unimplemented in the PDS we pinned — and is single-PDS anyway. The moment
  users live on _different_ PDSes (the whole point of federation), discovery is
  relay/firehose → AppView or nothing.
- Sharp edge: the PDS returns a cursor alongside the _final_ page, so naive cursor
  loops pay an extra empty-page round trip; terminate on empty page, not absent cursor.
  (#65)

### 5.3 Author identity resolution: handles change, and there are no roles

A testimony record's author is just the repo's DID. Everything MAPLE currently
snapshots onto testimony — display name, role, constituent district — is gone:

- The only name source in the protocol is the handle (one extra request per repo);
  display names need a profile lexicon or an AppView join. Handles can also _change_,
  so anything rendered from a handle is a live lookup, not a stored fact.
- There is **no role concept**. MAPLE's legislator/org/user distinction is
  unrepresentable in the record; the spike maps every author to `"user"` and the
  Organizations tab is honestly empty. Verified roles need either an ATProto **labeler**
  (a moderation-infrastructure service that attaches signed labels to DIDs) or
  app-controlled verification records published by MAPLE's own identity — both are
  AppView-adjacent services to build and govern. (#60, #65)

### 5.4 Authoritative identity is an out-of-band trust anchor

Nothing in the protocol marks maple's repo as "the" source of bills — any repo can hold
`org.mapletestimony.bill` records. The app must _pin_ the authoritative DID. The spike
pins via env var (`NEXT_PUBLIC_MAPLE_DID`); production would resolve a well-known handle
(e.g. `bills.mapletestimony.org` → DID via DNS/`.well-known`) and pin the result. Either
way the trust root is handle→DID resolution that MAPLE operates and users implicitly
trust — federation does not remove the authority, it just relocates it. (#61)

### 5.5 Bill mutability vs stale strongRef cids

Testimony pins the bill it references by `cid` (content hash). When MAPLE re-publishes a
bill record (new action, new hearing — routine), every existing testimony's strongRef
`cid` now points to a superseded version. That is arguably a _feature_ (provenance: "the
bill as the author saw it") but consumers must be written to resolve the reference by
`uri` and treat the `cid` as provenance metadata, never as a fetch key — a `getRecord`
by stale cid fails once the old block is gone. An AppView would store both: the current
bill and the referenced-version hash. (#60, #61, #64)

### 5.6 Moderation inverts: MAPLE can de-index, not delete

Today, MAPLE deletes abusive testimony from Firestore and it's gone. On ATProto the
record lives in the **author's** repo; MAPLE cannot delete it, only:

- **de-index it** from its own AppView (it disappears from mapletestimony.org but
  remains public in the author's repo, visible to any other client), and/or
- **label it** via a labeler service that cooperating clients respect.

This is the protocol working as designed — user ownership cuts both ways. It also means
MAPLE's moderation obligations (e.g. removing doxxing or defamation _from our site_) are
satisfiable, but "removal from the internet" is not in our power, and takedown workflows
become governance policy (what do we de-index, who decides, is there appeal) rather than
a database delete. Conversely, a _user_ can delete or rewrite their testimony at any
time and MAPLE cannot preserve it — the public-record/archival framing MAPLE uses today
(testimony as quasi-permanent civic record) is only achievable by the AppView _archiving
firehose events_, i.e. keeping copies the user has since deleted, which needs an explicit
retention policy. (Synthesis; roots in #60, #64)

### 5.7 Versioning, drafts, and edit history have no repo-side home

The PDS stores only the **latest** version of a record. Consequences, all observed:

- Rkey-upsert destroys history: no `updatedAt` is representable without an extra
  self-attested field; the spike preserves `createdAt` across edits so an edit is at
  least distinguishable from a new submission.
- MAPLE's 5-edit cap, required `editReason`, and per-version `archivedTestimony`
  audit trail have no equivalent. They become client-side honor system until an AppView
  enforces at ingest and archives versions from the firehose.
- **Private drafts are impossible as records** — records are public by definition.
  Drafts (and the debounced autosave flow) must stay app-local (in MAPLE's own store),
  meaning the publish flow is permanently hybrid: private app-side state that
  culminates in a public repo write. Attachments would be repo blobs (`uploadBlob`),
  unexplored in the spike. (#60, #64)

### 5.8 Schema enforcement is client-side only

The PDS validates records against lexicons it _knows_ (Bluesky's own). For foreign
NSIDs like ours it does structural (data-model) checks only — `putRecord` responses
carry `validationStatus: "unknown"`. Verified live: the PDS happily stores anything
JSON-shaped in our collections; nothing stops a hostile client writing garbage into
`org.mapletestimony.testimony`. So:

- Schema enforcement lives in our clients (`yarn atp:validate` in CI) and, in
  production, in the AppView at ingest — records failing our lexicon are simply not
  indexed.
- Reads must be treated as untrusted: the spike casts `getRecord` results on trust,
  which means one malformed record could crash bill-page SSR. Production reads validate
  with `@atproto/lexicon` before mapping. (#60, #63, #64)

### 5.9 Sessions and identity lifecycle have sharp edges

- The session API surface is one callback (`persistSession`), and distinguishing
  "network blip" from "session dead" matters: clearing on a network error signs users
  out permanently on flaky connections; _not_ clearing on account-gone leaves zombies.
- Observed zombie: an access token from a previous dev network passes signature checks
  on a new one, resume treats only-401 as expired, and the app lands "signed in" as a
  DID that no longer exists (failing with 400s, and `getRecord` on the dead DID
  returning **502**, not 400). A production session/error classifier needs at least
  three buckets — missing record / unresolvable identity / transport — where the spike
  started with two.
- Login errors are opaque by design (`AuthenticationRequired` for both bad handle and
  bad password); an identifier-first flow (resolve handle → DID before password) is the
  fix, and is what OAuth does naturally.
- The credential-session API we used (`AtpAgent.login`) is already marked deprecated
  upstream. (#62, #64)
- **Dual-auth UX is incoherent as shipped:** one page shows the Firebase navbar
  signed-out while the testimony panel is signed-in via PDS, with no linkage between a
  Firebase uid and a DID. Fine for a spike; a product needs one answer to "who am I" —
  which is an account-model design problem (link them? replace one?), not a technical
  blocker. (#62, #64)

### 5.10 The toolchain wall: ESM-only, node ≥22

Every `@atproto/*` package published since May 2026 is ESM-only with `engines.node

> =22`. MAPLE is node ^20 (hard engine enforcement), yarn 1, and a CJS `ts-node` script
toolchain. The spike pinned the last CJS train (`@atproto/api@0.19.x`,
`dev-env@0.4.9`+`resolutions` pins because upstream kept publishing node-22-only
> releases _within the same semver lines_). Costs already paid inside the spike:

- The pinned train receives no fixes and predates the OAuth browser client.
- `@atproto/pds` type declarations don't parse under our TS 5.3.3 (`skipLibCheck`
  doesn't suppress syntax errors) — `scripts/atproto` had to be excluded from the root
  tsconfig.
- Jest can't import `@atproto/api` at all (ESM dependency tree; `next/jest` doesn't
  transform node_modules) — testable code had to be structured behind interfaces so
  tests never load the agent.
- Codegen (`lex-cli`) was skipped for the same reason; fine for two hand-written types,
  not for a production lexicon suite.

**Migrating to node ≥22 + tolerating ESM-only deps is a prerequisite for any production
adoption, before feature work starts.** (#59, #60, #65)

### 5.11 Data-shape limits

- **Records max out at 150 KiB** (transport-enforced; measured by bisection). Bill
  metadata with summaries fits easily (2–6 KB); full bill text (`DocumentText`,
  hundreds of KB) cannot be a record — it's a blob or fetched from the legislature API
  on demand.
- **Upstream timestamps violate ATProto's `datetime` format.** MA legislature dates
  lack timezone offsets and fail lexicon validation; the spike stores them as plain
  strings. A production lexicon needs an explicit policy (normalize to UTC at ingest,
  or don't claim the format). (#60, #61)

## 6. Production architecture sketch

What running this for real would look like:

```
MA legislature API ──► ingest job ──► maple's repo (authoritative PDS)
                                       org.mapletestimony.bill records
                                       DID anchored by DNS handle, e.g.
                                       bills.mapletestimony.org

users' PDSes (self-hosted or MAPLE-hosted)
  org.mapletestimony.testimony records (user-owned)
        │
        ▼  firehose (via relay, once users span multiple PDSes)
┌─────────────────────────────────────────────┐
│  MAPLE AppView  (the big new build)         │
│  • validates records against our lexicons   │
│    at ingest; garbage is never indexed      │
│  • indexes testimony by bill; maintains     │
│    counters, latest-testimony, ordering,    │
│    pagination cursors, search, its own id   │
│    scheme (AT-URIs don't fit our routes)    │
│  • resolves DIDs → handles/profiles; joins  │
│    role verification (labeler or MAPLE-     │
│    published verification records)          │
│  • archives versions (edit history, and     │
│    testimony-as-civic-record retention)     │
│  • moderation = de-indexing + labels        │
└─────────────────────────────────────────────┘
        │
        ▼
Next.js reads from the AppView (bills, listings, counts, search)
writes go straight to the user's PDS (testimony publish)
```

- **Auth is OAuth or nothing.** `createSession` with a user's password is acceptable
  only against a PDS you own; against real user PDSes it's full-credential custody with
  no scopes or revocation. The production path is `@atproto/oauth-client-browser`:
  hosted client metadata, PAR + DPoP + PKCE, identifier-first login. None of it is
  exotic, all of it is new surface to build and operate.
- **Governance is a workstream, not a footnote:** who the authoritative identity is
  and how it's anchored (DNS), how legislator/org verification is granted and revoked
  (labeler policy), what gets de-indexed and how appeals work, and what the AppView's
  retention policy is for records users have deleted.
- **Prerequisites before feature work:** node ≥22 + ESM migration (§5.10), lexicon
  codegen via `lex-cli`, and a decision on the Firebase-account ↔ DID relationship
  (§5.9).
- **Hybrid is the realistic shape, and it's leaky.** Drafts, notifications, profiles,
  and search stay app-side regardless; the spike also showed navigation leaking back
  into Firestore-backed pages from inside "ATProto" pages. A partial adoption
  (testimony-on-ATProto, everything else as-is) still requires the full AppView + OAuth
  stack — the cost is front-loaded, the benefit incremental.

## 7. Go/no-go recommendation

**No-go as a near-term replacement for Firestore. Conditional go as a strategic
direction — condition: MAPLE decides user-owned, portable testimony is a mission goal
worth an infrastructure program, not a feature.**

The case for: the spike proved the write side is _elegant_ — user-owned testimony,
free one-per-bill invariant, provable edit semantics, version-pinned bill references.
For an organization whose product is public civic testimony, "your testimony is yours,
cryptographically, portable, and not locked in our database" is a genuinely
differentiating, mission-aligned property that Firestore can never provide.

The case against, from the evidence above: everything MAPLE _reads_ requires building
and operating an AppView (§5.1–5.3) — an always-on firehose consumer with its own
index, id scheme, identity resolution, verification join, archival store, and
moderation pipeline. That is most of MAPLE's current backend, rebuilt, plus an OAuth
stack (§6), plus a node/ESM migration (§5.10), plus governance work (§5.6, §5.4) —
before reaching parity with what Firestore does today. Moderation and archival
_invert_ (§5.6): both become policy questions with new operational obligations. And
MAPLE's team is small; the AppView is not a weekend service.

If the strategic answer is yes, the incremental path is: (1) node ≥22 / ESM migration
on its own merits; (2) testimony-only adoption behind the existing publish seam
(`useEditTestimony`'s interface is the swap point — see notes #64), with a minimal
AppView indexing exactly one collection; (3) OAuth against MAPLE-hosted PDS accounts
first, federation later. If the answer is no, this spike still pays for itself as
documentation of why, and the branch is a working reference implementation.

## Appendix: code map

All on the `atp-spike` branch:

| Path                                               | What it is                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/atproto/dev-env.ts`                       | `yarn atp:dev` — boots the local PLC + PDS                          |
| `scripts/atproto/seed.ts`, `seed-data.ts`          | `yarn atp:seed` — accounts, 4 real bills, bob's testimony           |
| `scripts/atproto/validate-lexicons.ts`             | `yarn atp:validate` — lexicon + round-trip validation (CI-able)     |
| `scripts/atproto/probe-*.ts`                       | one-shot probes (PDS validation behavior, 150 KiB record ceiling)   |
| `lexicons/org/mapletestimony/`                     | `bill.json`, `testimony.json` lexicon schemas                       |
| `components/atproto/lexicons.ts`                   | hand-written record types                                           |
| `components/atproto/mappers.ts`                    | `Bill`/`Testimony` ↔ record mappers (incl. dropped-field decisions) |
| `components/atproto/auth.tsx`                      | ATProto session provider (context + localStorage)                   |
| `components/atproto/api.ts`                        | server/client read+write helpers (`getAtpBill`, `putAtpTestimony`…) |
| `components/atproto/testimonyFanout.ts`            | the cross-repo fan-out (pure, tested)                               |
| `components/atproto/useAtprotoTestimonyListing.ts` | listing hook adapting the fan-out to `ViewTestimony`                |
| `components/atproto/Atp*.tsx`                      | bill details, testimony panel, setup alert                          |
| `pages/atp/`                                       | `/atp/login`, `/atp/bills`, `/atp/bills/[court]/[billId]`           |
| `docs/atproto-spike-notes.md`                      | raw per-issue log (what landed / problems / verified AC)            |

Per-issue → theme cross-reference: #59 → §5.10; #60 → §5.1, 5.5, 5.7, 5.8, 5.11;
#61 → §5.4, 5.11; #62 → §5.9; #63 → §5.1, 5.8; #64 → §5.5–5.9; #65 → §5.1–5.3, 5.10.
