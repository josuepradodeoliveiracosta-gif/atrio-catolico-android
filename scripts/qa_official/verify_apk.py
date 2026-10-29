"""Pin the existing build artifact, APK identity, certificate and Firebase project."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from common import PROJECT, PACKAGE, REPO, accounts, digest, request, require, validate_source


def command(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def verify():
    require(os.environ.get("GITHUB_REPOSITORY") == REPO, "wrong_repository")
    require(os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "manual_only")
    require(os.environ.get("GITHUB_RUN_ATTEMPT") == "1", "rerun_not_allowed")
    accounts(os.environ["ATRIO_QA_BOTS_JSON"])
    build_id = os.environ["APK_RUN_ID"]
    require(re.fullmatch(r"[1-9][0-9]+", build_id), "invalid_build_id")
    token = os.environ["GH_TOKEN"]
    base = f"https://api.github.com/repos/{REPO}/actions/runs/{build_id}"
    run = request(base, token=token)
    artifacts = request(base + "/artifacts", token=token)["artifacts"]
    matches = [a for a in artifacts if a["name"] == "atrio-catolico-release-assinado"]
    require(len(matches) == 1, "signed_artifact_missing")
    validate_source(run, matches[0])
    files = list(Path("official-apk").rglob("*.apk"))
    require(len(files) == 1, "ambiguous_apk")
    apk = str(files[0])
    sha = hashlib.sha256(Path(apk).read_bytes()).hexdigest()
    require(sha == digest(os.environ["APK_SHA256"]), "apk_hash_mismatch")
    sdk = Path(os.environ["ANDROID_HOME"])
    cert_output = command(str(sdk / "build-tools/35.0.0/apksigner"), "verify", "--print-certs", apk)
    certs = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)", cert_output)
    require(len(certs) == 1 and digest(certs[0]) == digest(os.environ["ATRIO_RELEASE_CERT_SHA256"]), "certificate_mismatch")
    analyzer = str(sdk / "cmdline-tools/latest/bin/apkanalyzer")
    require(command(analyzer, "manifest", "application-id", apk) == PACKAGE, "package_mismatch")
    require(command(analyzer, "manifest", "debuggable", apk) == "false", "debug_apk_refused")
    def resource(name):
        return command(analyzer, "resources", "value", "--config", "default", "--type", "string", "--name", name, apk).strip('"')
    require(resource("project_id") == PROJECT, "firebase_project_mismatch")
    key = resource("google_api_key")
    require(re.fullmatch(r"[A-Za-z0-9_-]+", key), "invalid_api_key")
    Path("qa-official-results").mkdir(exist_ok=True)
    evidence = {"build_run_id": build_id, "source_sha": run["head_sha"], "apk_sha256": sha,
                "certificate_sha256": digest(certs[0]), "package": PACKAGE, "project": PROJECT,
                "version": command(analyzer, "manifest", "version-name", apk)}
    Path("qa-official-results/apk.json").write_text(json.dumps(evidence, indent=2))
    # Public API key from the verified APK, not a service-account credential.
    with open(os.environ["GITHUB_ENV"], "a") as env:
        env.write(f"VERIFIED_APK={apk}\nFIREBASE_WEB_API_KEY={key}\n")


if __name__ == "__main__":
    try:
        verify()
        print("APK assinado e origem conferidos.")
    except Exception:
        print("Preflight do APK falhou; confira artefato, hashes, certificado e configuracao.")
        sys.exit(1)
