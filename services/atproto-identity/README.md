# atproto-identity

Terraform semantics for MAPLE's `did:plc`, without Terraform.

A reviewed spec per environment, a keyless `plan` that diffs it against the live
PLC directory, and an `apply` that a person runs. [ADR 0002](../../docs/adr/0002-atproto-identity-key-custody.md)
§6 decided this; the reasoning for not using Terraform is there — no PLC
provider exists, and a DID is a create-exactly-once resource whose "recreate" is
a different identity.

## The spec

`infra/identity/<env>.json`, **public material only**:

```json
{
  "did": "",
  "handle": "maple.pds-dev.mapletestimony.org",
  "pdsEndpoint": "https://pds-dev.mapletestimony.org",
  "plcUrl": "https://plc.directory",
  "rotationKeys": ["did:key:z…recovery", "did:key:z…ops"],
  "verificationMethods": { "atproto": "" }
}
```

`rotationKeys` is in **priority order**: an earlier key can nullify an operation
signed by a later one, within 72 hours. First is the recovery key, generated
offline and never on a server. Second is the ops key, an HSM-backed Cloud KMS
key (`infra/gcp/kms.tf`) whose private bytes nobody holds: `--kms <resource>`
asks the HSM to sign each operation, and only the people in `infra/gcp/iam/`'s
`identity_signers` may (the variable refuses service accounts).

Two fields are written back by the tool, not by hand, because the network
chooses them: `did` at genesis, and `verificationMethods.atproto` when the PDS's
own signing key is adopted.

## Commands

    yarn plan   --env dev          # keyless. non-zero on drift. safe to run anywhere
    yarn apply  --env dev --kms projects/digital-testimony-dev/locations/us-central1/keyRings/atproto/cryptoKeys/identity-ops

`plan` reads `<plcUrl>/<did>` and diffs the four fields the spec owns. It is the
same command CI runs, and on a schedule it is the drift alarm.

`apply` builds the operation, signs it with a rotation key, and submits it. It
prints the audit-log URL every time. Full verb list: `yarn identity help`.

## Standing up an identity

The sequence that replaces "call `createAccount` on the PDS".

1. `keygen` the recovery key **offline**. Put its `did:key` first in the spec;
   store the private half in a password manager and on paper. Never on a server.
2. The ops key already exists: it is the KMS key terraform created.
   `pubkey --kms <resource>` prints its `did:key`; it goes second in the spec.
3. `keygen` an initial signing key. Genesis must name some signing key, and
   `createAccount` for a DID the PDS did not mint must be authorised by whatever
   key the document currently names. This one is discarded at step 6.
4. `genesis` (`--kms`) — signs the create operation with the ops key and writes the
   resulting DID back into the spec. **The only irreversible step.**
5. `create-account` — `com.atproto.server.createAccount` carrying the DID and a
   service JWT signed with the initial signing key. The account lands
   **deactivated**; that is the migration path's normal behaviour.
6. `rotate-signing-key` — adopt the signing key the PDS generated for itself,
   write it into the spec, apply. Discard the initial signing key.
7. `activate` — put the repo on the firehose. See below.

## Why `activate` makes three PLC operations

`com.atproto.server.activateAccount` asserts that the PDS's **own** rotation key
is in `rotationKeys` (`account-manager.js` → `api/com/atproto/server/util.js`,
`assertValidDocContents`). That key lives on the VM. A document naming it lets a
compromised box attempt to move the identity, which is the single outcome
ADR 0002 §1 exists to prevent.

So `activate` borrows it: apply the spec plus the PDS's key, call
`activateAccount`, apply the spec again. The document names a VM-held key for
the length of one operation and ends exactly where the spec says.

This is safe to leave in that shape because the assertion sits on **no hot
path**. Its only two callers are `activateAccount` itself and
`checkAccountStatus`, which merely _reports_ `validDid`. Nothing in auth, session
creation, repo writes or the firehose consults it.

Two consequences worth knowing before they surprise someone:

- **`checkAccountStatus` reports `validDid: false` from then on.** Expected, not
  an error.
- **Re-activation needs the borrow again.** A deliberate `deactivateAccount`, or
  rebuilding the account from scratch, means re-running `activate`. It fails
  loudly with `Server rotation key not included in PLC DID data` if skipped. A
  disk restore does not need it — the activated flag lives in the account
  database on the snapshotted disk.
- **The PDS's `updateHandle` will not work for this account**, since it would
  sign with a key that is not in the list. Intended: handle changes go through a
  reviewed spec change and `apply`.

A future PDS version that moves that check onto a hot path would break this
sequence, so the PDS image the tool is exercised against is pinned.

## Tests

    yarn test        # unit: op construction, the plan diff, every safety rail. no network

The live half — drift, the recovery-key rehearsal and the PDS-key rejection
against a real did-plc server — runs against the local harness. Nothing in the
test suite touches `plc.directory`.

## Safety rails

- `genesis` refuses if the spec already names a DID.
- `apply` refuses to empty `rotationKeys`, to drop the first (recovery) key, or
  to replace every key at once, without `--i-mean-it`.
- `plcUrl` must be explicit; it never falls back to `plc.directory`.
- `--env prod` needs `--yes-really-prod`.
- Private material is never printed, logged, or written to the spec.

## Dependencies

`@atcute/did-plc` and `@atcute/crypto`, pinned exact. This process holds a
rotation key in memory, so its dependency tree is inside the custody boundary
ADR 0002 draws and is kept deliberately small — the XRPC calls are hand-rolled
rather than pulling in `@atproto/api`.
