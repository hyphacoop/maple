# Gated: no consumer resources exist until an image is built and
# consumer_image is set in the env tfvars.
#
# Scope, which the gate makes easy to forget: this service writes the shadow
# collections and never touches the live ones. What reads from them is a
# separate decision, and not one this root makes.
#
# Before that flip: Cloud Run's default TCP startup probe requires the
# container to listen on $PORT, and the consumer opens no port — it needs a
# trivial health listener in the service (preferred) or a startup_probe here.
# Instance size is also unvalidated against full-network relay volume; revisit
# once it has been measured against real traffic.
resource "google_cloud_run_v2_service" "consumer" {
  count = var.consumer_image != "" ? 1 : 0

  name     = "atproto-consumer"
  location = var.region

  # Serves nothing; the websocket to jetstream is outbound.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  # Provider >= 6 defaults this to true, which would wedge flipping the
  # consumer_image gate back to "" (the destroy would be refused).
  deletion_protection = false

  labels = local.labels

  template {
    service_account = google_service_account.consumer.email

    # min 1: the jetstream subscription must stay live (ADR 0001 §2).
    # max 1: there must be exactly one cursor writer.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = var.consumer_image

      resources {
        # cpu_idle = false is the v2 spelling of --no-cpu-throttling: CPU stays
        # allocated between requests so the websocket keeps being served.
        cpu_idle = false
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # Only set when overridden — otherwise the consumer's own default host
      # applies, keeping services/atproto-consumer/src/index.ts the single
      # definition (same gating pattern as consumer_image).
      dynamic "env" {
        for_each = var.jetstream_url != "" ? [var.jetstream_url] : []

        content {
          name  = "JETSTREAM_URL"
          value = env.value
        }
      }

      env {
        name  = "GCLOUD_PROJECT"
        value = var.project_id
      }

      # Without this the consumer forces FIRESTORE_EMULATOR_HOST=localhost:8080
      # (its safety default for unset environments).
      env {
        name  = "ALLOW_LIVE_FIRESTORE"
        value = "true"
      }

      env {
        name  = "MAPLE_DIDS"
        value = var.maple_dids
      }
    }
  }
}
