# atproto-identity

Terraform semantics for MAPLE's `did:plc`, without Terraform: a reviewed spec per environment, a
keyless `plan` that diffs it against the live PLC directory, and an `apply` a person runs. Why it
is shaped this way: [DESIGN.md](DESIGN.md). Custody: [ADR 0002](../../docs/adr/0002-atproto-identity-key-custody.md).

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

`rotationKeys` is in **priority order**: an earlier key nullifies what a later one signed, within
72 hours. First the recovery key, offline and never on a server; second the ops key, HSM-backed
in Cloud KMS (`infra/gcp/kms.tf`) with nobody holding its private bytes — `--kms <resource>` asks
the HSM to sign, and only members of `identity_signers` (`infra/gcp/envs/<env>.tfvars`) may.
`did` and `verificationMethods.atproto` are written back by the tool: the network chooses them.

## Commands

    yarn plan   --env dev          # keyless. non-zero on drift. safe to run anywhere
    yarn apply  --env dev --kms projects/digital-testimony-dev/locations/us-central1/keyRings/atproto/cryptoKeys/identity-ops

`plan` diffs `<plcUrl>/<did>` against the four fields the spec owns; it is what CI runs, and on a
schedule it is the drift alarm. `apply` builds the operation, signs it, submits it, and prints
the audit-log URL. Full verb list: `yarn identity help`.

## Standing up an identity

1. `keygen` the recovery key **offline**. Its `did:key` goes first in the spec; the private half
   goes to a password manager and paper, never to a server.
2. `pubkey --kms <resource>` prints the ops key's `did:key`. It goes second.
3. `keygen` an initial signing key — genesis must name one, and it is discarded at step 6.
4. `genesis --kms` signs the create operation and writes the DID back into the spec. **The only
   irreversible step.**
5. `create-account` carries that DID to the PDS. The account lands **deactivated**: that is the
   migration path behaving normally, not a failure.
6. `rotate-signing-key` adopts the signing key the PDS generated for itself. Discard the initial
   one.
7. `activate` puts the repo on the firehose. It makes three PLC operations and leaves
   `checkAccountStatus` reporting `validDid: false` for good — both expected, both explained in
   [DESIGN.md](DESIGN.md). Re-run it after any `deactivateAccount` or account rebuild, or the
   call fails with `Server rotation key not included in PLC DID data`. A disk restore needs no
   re-run: the activated flag is on the snapshotted disk.

## Tests

    yarn test        # unit: op construction, the plan diff, every safety rail. no network
    yarn test:live   # the custody scenarios against a real PLC. needs docker

`test:live` mints a throwaway identity on a local did-plc server — the same code `plc.directory`
runs, from a pinned commit — and asserts the two properties the custody split rests on: `plan`
exits non-zero on out-of-band drift, and the recovery key nullifies an operation the ops key
signed. Keys are per-run and die with the stack; nothing in the suite touches `plc.directory`.
The scenarios are in `test/live/scenarios.sh`, sourced rather than run, so a rig with a PDS can
drive the same assertions and add the ones needing one.

## Safety rails

- `genesis` refuses if the spec already names a DID.
- `apply` refuses to empty `rotationKeys`, drop the recovery key, or replace every key at once,
  without `--i-mean-it`.
- `plcUrl` must be explicit; it never falls back to `plc.directory`.
- `--env prod` needs `--yes-really-prod`.
- Private material is never printed, logged, or written to the spec.
