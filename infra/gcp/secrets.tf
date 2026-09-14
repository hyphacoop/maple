# Secret RESOURCES only — never versions. Terraform state stores values in
# plaintext, so secret material is added out of band (ADR 0001):
#   gcloud secrets versions add <secret-id> --data-file=-
resource "google_secret_manager_secret" "pds" {
  for_each = toset(values(local.pds_secrets))

  secret_id = each.value
  labels    = local.labels

  replication {
    auto {}
  }
}

# UPPER_SNAKE on purpose, unlike the trio above: the publisher's
# defineSecret("ATP_PDS_PASSWORD") (services/atproto-publisher/src/config.ts on
# the atproto-publisher branch) maps the name to the secret id verbatim. Ordering matters: apply this before
# anyone runs `firebase functions:secrets:set ATP_PDS_PASSWORD`, or Firebase
# creates the secret first and whoever lands the PDS has to `terraform import` it (see README).
resource "google_secret_manager_secret" "atp_pds_password" {
  secret_id = "ATP_PDS_PASSWORD"
  labels    = local.labels

  replication {
    auto {}
  }
}
