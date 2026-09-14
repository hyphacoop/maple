# ADR 0002: custody of MAPLE's identity keys

- **Status:** Proposed (2026-09-01; accepted with the identity work)
- **Depends on:** [ADR 0001](0001-atproto-infra.md)

## Context

MAPLE's identity is a `did:plc`. Its DID document lists rotation keys in priority order;
any of them can move the account to another PDS, replace the signing key or change the
handle, and an earlier key can undo a later key's operation within 72 hours. The rotation
keys are the identity. The signing key is operational: it signs repo commits and any
rotation key can replace it.

The reference PDS mints a DID for each account it creates and puts its own rotation key in
the document. That key is read into the PDS from Secret Manager at boot; anyone with
`roles/editor` on the project, or a copy of the VM's disk, can reach it.

## Decision

MAPLE's DID is minted outside the PDS and names two rotation keys, in this order:

1. **A recovery key**, generated offline and held by people, never on a server. Its only
   use is undoing an operation by the ops key within the 72-hour window.
2. **An ops key** in Cloud KMS (HSM, non-exportable). Named people sign with it; no
   service account, and never the PDS VM. Every signature is an audit-log line.

The PDS's own rotation key is not in the document: the account is created with the
pre-minted DID, so a compromise of the VM, its disk or its snapshots yields the signing
key only, which any rotation key can replace. (Activating the account needs the PDS key
present for one operation; it is added for that call and removed.)

Custody: in dev the working group holds the recovery key and signs with the ops key. In
prod two named people on the upstream side do both; Hypha keeps no copy.

## Consequences

- Identity changes (handle, signing key, PDS endpoint) are signed by a person with the ops
  key, not by an XRPC call on the PDS.
- Losing the ops key is not losing the identity; the recovery key rotates in a
  replacement. Losing both is.
- `roles/editor` can still read the server-side secrets and the disk. Accepted for phase
  1; fixing it means a separate project and would not remove the disk exposure.
- The prod handoff gains a step: naming the recovery-key holders and signers.

## Alternatives

- **Let the PDS mint the DID**, as for every other account. The PDS key becomes a
  rotation key for MAPLE's institutional identity, inside the blast radius of any VM
  compromise.
- **Ops key in Secret Manager.** Every accessor holds the private bytes.
- **`did:web`.** Welds the identity to a Vercel deployment upstream controls, with no
  key-based recovery.

## Open

Who the two prod holders are.
