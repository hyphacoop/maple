# MAPLE's PLC ops key (ADR 0002): the rotation key every routine identity
# operation is signed with, by a person running the identity tool
# (services/atproto-identity).
#
# It lives in Cloud KMS, not Secret Manager: nobody ever holds the private
# bytes. A signer asks the HSM for a signature over a digest and gets one audit
# log line per operation; the key cannot be exported, and "who may sign" is an
# explicit IAM grant to named people in iam.tf (never to a service account, and
# never to the PDS VM — the whole point of the custody model). secp256k1 is
# HSM-only in Cloud KMS, which is what we want anyway.
#
# Key rings cannot be deleted, and a destroyed key version has a scheduled
# destruction window (30 days here). Loss of this key is NOT loss of the
# identity: the offline recovery key outranks it and rotates in a replacement
# (ADR 0002).
resource "google_kms_key_ring" "atproto" {
  name     = "atproto"
  location = var.region
}

resource "google_kms_crypto_key" "identity_ops" {
  name     = "identity-ops"
  key_ring = google_kms_key_ring.atproto.id
  purpose  = "ASYMMETRIC_SIGN"
  labels   = local.labels

  version_template {
    algorithm        = "EC_SIGN_SECP256K1_SHA256"
    protection_level = "HSM"
  }

  destroy_scheduled_duration = "2592000s" # 30 days

  lifecycle {
    prevent_destroy = true
  }
}
