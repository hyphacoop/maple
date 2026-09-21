# atproto-identity: design

Operational use is [README.md](README.md). The decision this implements is
[ADR 0002](../../docs/adr/0002-atproto-identity-key-custody.md). This file is the reasoning in
between: why the tool exists in this shape, and the two upstream behaviours that shaped it.

## Why not Terraform

MAPLE's DID wants exactly what Terraform gives infrastructure — a reviewed desired state, a diff
before you touch anything, an audited apply — and none of the machinery. There is no PLC
provider, and writing one would be a poor trade: a DID is a create-exactly-once resource whose
"recreate" is not a recreate at all but a different identity, which is the one operation a
Terraform-shaped tool makes easy to do by accident.

So the shape is borrowed and the engine is not. `infra/identity/<env>.json` is the desired state,
`plan` is the diff, `apply` is the human-run change. `plan` is keyless on purpose: it reads the
public directory and needs no signing material, so it is safe to run anywhere, in CI and on a
schedule, which is what makes it a drift alarm as well as a pre-flight.

## Why `activate` makes three PLC operations

`com.atproto.server.activateAccount` asserts that the PDS's **own** rotation key is in
`rotationKeys` (`account-manager.js` → `api/com/atproto/server/util.js`, `assertValidDocContents`).
That key lives on the VM. A document naming it lets a compromised box attempt to move the
identity — the single outcome ADR 0002's first Decision key exists to prevent.

So `activate` borrows it: apply the spec plus the PDS's key, call `activateAccount`, apply the
spec again. The document names a VM-held key for the length of one operation and ends exactly
where the spec says.

That is safe to leave in this shape because the assertion sits on **no hot path**. Its only two
callers are `activateAccount` itself and `checkAccountStatus`, which merely _reports_ `validDid`.
Nothing in auth, session creation, repo writes or the firehose consults it.

Three consequences, all of which will otherwise surprise someone:

- **`checkAccountStatus` reports `validDid: false` from then on.** Expected, not an error.
- **Re-activation needs the borrow again.** A deliberate `deactivateAccount`, or rebuilding the
  account from scratch, means re-running `activate`. Skipped, it fails loudly:
  `Server rotation key not included in PLC DID data`. A disk restore does not need it, because
  the activated flag lives in the account database on the snapshotted disk.
- **The PDS's `updateHandle` will not work for this account**, since it would sign with a key
  that is not in the list. Intended: handle changes go through a reviewed spec change and
  `apply`, which is the whole point of having a spec.

A future PDS version that moved that check onto a hot path would break the sequence, which is why
the PDS image this tool is exercised against is pinned, and why the harness runs the full
sequence in CI rather than leaving it written down.

## Why the dependency tree is small

`@atcute/did-plc` and `@atcute/crypto`, pinned exact, and the XRPC calls hand-rolled rather than
pulling in `@atproto/api`. This process holds a rotation key in memory, so everything it imports
is inside the custody boundary ADR 0002 draws. A convenience dependency here is a supply-chain
path to the key that can move MAPLE's identity.
