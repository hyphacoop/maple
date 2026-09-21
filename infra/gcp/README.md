# atproto PDS on GCP

One Terraform root, one state per environment (`envs/<env>.*`), applied as a whole. Applies are
human-run; CI only plans. What is in here and why: [DESIGN.md](DESIGN.md). The decision:
[ADR 0001](../../docs/adr/0001-atproto-infra.md).

## Permissions

On the environment's project, `roles/editor` for every step plus `roles/owner` for the grants in
`iam.tf`: an editor's apply ends red on exactly those, and an owner's then plans them. On
`digital-testimony-prod`, `roles/dns.admin` for the parent-zone NS record and at least
`roles/dns.reader` or nothing here plans; `roles/owner` there only for CI ([CI.md](CI.md)).

## Apply

[dns/README.md](dns/README.md) first: this root looks that zone up, and until the delegation
resolves Caddy gets no certificate. `pds_hostname` is apply-once; prod needs `identity_signers`.

```sh
infra/gcp/scripts/bootstrap.sh dev                              # 1. APIs and the state bucket
terraform -chdir=infra/gcp init -backend-config=envs/dev.gcs.tfbackend
terraform -chdir=infra/gcp apply -var-file=envs/dev.tfvars      # 2. everything in Cost, below
infra/gcp/scripts/secrets.sh dev                                # 3. secret versions and the blob HMAC key; never rotates
curl https://pds-dev.mapletestimony.org/xrpc/_health            # green within 3 min of step 2
gcloud storage ls gs://digital-testimony-dev-atproto-pds-blobs/  # after one uploadBlob lands
```

Then delete the record that blob belonged to: the object must leave the bucket — the one blobstore
call a first apply has to prove, and `pds-startup.sh.tftpl` says what it means if it stays. Not
applied here: secret versions and the HMAC key (step 3), the state bucket (step 1), MAPLE's DID
(the identity tool), and `ATP_PDS_PASSWORD` via `firebase functions:secrets:set` after step 2
(`secrets.tf` says why that order). The consumer is gated too: `consumer_image = ""` creates no
Cloud Run service, so push an image to the `atproto` repo and set it with `maple_dids`. Prod is
the same with `prod`.

## Rollback

- **Config**: revert and apply; a startup-script change lands on the next boot, or
  `gcloud compute instances reset atproto-pds --zone=us-central1-a` now.
- **A secret**: `gcloud secrets versions add <id> --data-file=-`, then reset the VM or re-run
  `sudo google_metadata_script_runner startup` over IAP ssh — either re-reads every secret and
  restarts the PDS, and nothing is on disk. Disable the old version.
- **Data and state**: create a disk from a snapshot, attach it as `pds-data`; blobs are in the
  bucket, and the state bucket is versioned.
- **Teardown**: `destroy` refuses by design (`prevent_destroy`, deletion protection).

## Monitoring

Alerts go to `alert_channels` in `envs/<env>.tfvars`, subjects prefixed `[<env>]`; thresholds are
in `monitoring-pds.tf` and each page carries its own first step. Prove the channel once per
environment: ssh in, `sudo systemctl stop pds.service`, wait for the page (≤ 6 min), `start` it —
expect one during bring-up. Not watched: consumer, publisher, cursor lag.

## Cost

| Resource                                 |        dev |       prod |
| ---------------------------------------- | ---------: | ---------: |
| `e2-small`, 730 h                        |     $12.23 |     $12.23 |
| Balanced PD, 30 GiB (10 boot + 20 data)  |      $3.00 |      $3.00 |
| Static external IP, attached             |      $3.65 |      $3.65 |
| Cloud KMS, HSM secp256k1 key version     |      $2.50 |      $2.50 |
| Cloud DNS, one managed zone              |      $0.20 |      $0.20 |
| Cloud Run consumer, min 1, CPU always on |      gated |      gated |
| **Total**                                | **$21.58** | **$21.58** |

Opening the consumer gate adds ~$49.93/month per environment, dwarfing everything above. Scales
with use and excluded: snapshots, blobs (nothing prunes them), KMS signing, DNS queries, egress.
Everything else the root creates is free at this size. List prices us-central1, Billing Catalog
API, 2026-09-21; prod is unapplied, so its column is a projection.

## CI

`.github/workflows/terraform-checks.yml`: `fmt`, `validate` and an advisory dev plan on PRs. What
runs, and the one-time setup it needs: [CI.md](CI.md).
