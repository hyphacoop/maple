# Always created, even while consumer_image is empty: the image must be pushed
# here before consumer_image can be set, so gating this on the same variable
# would be circular. An empty repo costs nothing.
resource "google_artifact_registry_repository" "atproto" {
  repository_id = "atproto"
  format        = "DOCKER"
  location      = var.region
  description   = "atproto service images (firehose consumer)"
  labels        = local.labels
}
