# ADR 0003: keys for user accounts

- **Status:** Proposed (2026-09-08)
- **Depends on:** [ADR 0002](0002-atproto-identity-key-custody.md)

## Context

MAPLE will open signup on its PDS after phase 1. The PDS then mints each user's DID and
puts its own rotation key in the document, as every PDS does. The operator can place one
key ahead of it (`PDS_RECOVERY_DID_KEY`), and a user can add a key of their own above both
through the PDS's emailed-challenge flow. Bluesky sets no recovery key: it is the sole
custodian of every account it hosts.

## Decision

Every user account's document lists, in order: the user's own key if they add one; a
fleet recovery key set on the PDS; the PDS rotation key.

The fleet recovery key is generated offline and held by people. It is a different key from
MAPLE's institutional recovery key, so neither is lost or leaked through the other. It is
set before the first user account is created; it does not apply to accounts minted
earlier.

Before signup opens in prod, the PDS rotation key moves from Secret Manager into Cloud
KMS. The reference PDS supports AWS KMS only, so that is an upstream contribution. If
signup must open first, the accounts minted meanwhile are migrated with one operation
each.

MAPLE's own account is unchanged: two keys per ADR 0002, PDS key excluded.

## Consequences

- Phase 1 changes nothing; the PDS is invite-only.
- A VM compromise reaches user accounts, bounded by the fleet key's 72-hour override, but
  never MAPLE's identity. That is why MAPLE's DID is minted outside the PDS.
- One more offline key ceremony at handoff.

## Open

- Whether to open signup before the KMS rotation key lands.
- Whether the fleet recovery holders are the same people as MAPLE's.
