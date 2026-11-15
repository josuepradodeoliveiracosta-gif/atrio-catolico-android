"""Integrity checks for the official APK and read-only requests to GitHub."""
import json
import re
import urllib.request

PROJECT = "atrio-catolico"
PACKAGE = "br.com.atriocatolico"
REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(value):
    value = value.replace(":", "").strip().lower()
    require(re.fullmatch(r"[0-9a-f]{64}", value), "invalid_sha256")
    return value


def request(url, *, token):
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "Authorization": "Bearer " + token},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except Exception:
        raise RuntimeError("remote_request_failed") from None


def validate_source(run, artifact):
    require(run.get("repository", {}).get("full_name") == REPO, "wrong_repository")
    require(run.get("path") == ".github/workflows/build-apk.yml", "wrong_build_workflow")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "build_not_successful")
    require(artifact.get("name") == "atrio-catolico-release-assinado" and not artifact.get("expired"), "invalid_artifact")
    require(artifact.get("workflow_run", {}).get("id") == run.get("id"), "artifact_run_mismatch")
