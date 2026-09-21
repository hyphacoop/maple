resource "google_service_account" "pds" {
  account_id   = "atproto-pds"
  display_name = "atproto PDS VM"
}

resource "google_service_account" "consumer" {
  account_id   = "atproto-consumer"
  display_name = "atproto firehose consumer (Cloud Run)"
}
