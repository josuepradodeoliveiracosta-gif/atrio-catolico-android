# PLAN-ONLY candidate. DO NOT apply without explicit IAM/legal approval.
# Requires an existing server-side caller service account; never anonymous.
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
  }
}

variable "project_id" {
  type    = string
  default = "atrio-catolico"
  validation {
    condition     = var.project_id == "atrio-catolico"
    error_message = "Only the reviewed atrio-catolico project may be used."
  }
}
variable "region" {
  type    = string
  default = "southamerica-east1"
  validation {
    condition     = contains(["southamerica-east1", "us-central1"], var.region)
    error_message = "Region requires an explicitly reviewed choice."
  }
}
variable "caller_service_account" {
  type        = string
  description = "Existing distinct server-to-server invoker identity."
  validation {
    condition = can(regex(
      "^[a-z][a-z0-9-]{4,28}@[a-z][a-z0-9-]{3,30}\\.iam\\.gserviceaccount\\.com$",
      var.caller_service_account
    )) && var.caller_service_account != "atrio-privacy-reader@atrio-catolico.iam.gserviceaccount.com"
    error_message = "Provide a distinct reviewed service-account caller."
  }
}
variable "container_image" {
  type        = string
  description = "Manually reviewed Artifact Registry image, immutable digest."
  validation {
    condition = can(regex(
      "^[a-z0-9-]+-docker\\.pkg\\.dev/atrio-catolico/[a-z0-9-]+/[a-z0-9_./-]+@sha256:[0-9a-f]{64}$",
      var.container_image
    ))
    error_message = "Use a reviewed atrio-catolico Artifact Registry sha256 digest."
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_service_account" "reader" {
  project      = var.project_id
  account_id   = "atrio-privacy-reader"
  display_name = "Atrio private account deletion READ review"
  description  = "No Firestore/Auth writes, no deletion, no signing."
}

resource "google_project_iam_member" "reader_firestore" {
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.reader.email}"
}

resource "google_project_iam_member" "reader_auth" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.reader.email}"
}

resource "google_cloud_run_v2_service" "review" {
  project              = var.project_id
  name                 = "atrio-privacy-review-internal"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  invoker_iam_disabled = false
  deletion_protection  = true

  template {
    service_account                  = google_service_account.reader.email
    timeout                          = "60s"
    max_instance_request_concurrency = 1
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.container_image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
    }
  }

  depends_on = [
    google_project_iam_member.reader_firestore,
    google_project_iam_member.reader_auth
  ]
  lifecycle {
    prevent_destroy = true
  }
}

# Authoritative only for Invoker on this service.
resource "google_cloud_run_v2_service_iam_binding" "invoker" {
  project  = google_cloud_run_v2_service.review.project
  location = google_cloud_run_v2_service.review.location
  name     = google_cloud_run_v2_service.review.name
  role     = "roles/run.invoker"
  members  = ["serviceAccount:${var.caller_service_account}"]
}
