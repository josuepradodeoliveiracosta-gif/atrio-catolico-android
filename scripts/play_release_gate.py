#!/usr/bin/env python3
"""Preflight local, sem rede e sem segredos, para AAB Play assinado.

Nao prova que o app cumpre a Play: evidencia e assinatura exigem revisao externa.
Nunca modifica versoes, arquivos, variaveis, permissoes ou chaves.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

EXPECTED_PACKAGE = "br.com.atriocatolico"
EXPECTED_FIREBASE_PROJECT = "atrio-catolico"
EXPECTED_TRACK = "Google Play — testes fechados"
OTA_VERSION_FLOOR = 36  # Candidato OTA 0.20.1 da PR #70; rever com o proximo OTA.
MAX_PLAY_VERSION = 2_100_000_000
REQUIREMENTS = frozenset({
    "in_app_request", "external_portal", "deletion_executor",
    "worker_freeze", "retention_review", "public_privacy_policy",
    "data_safety", "operational_security", "closed_track_e2e"
})


def real_https_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower().rstrip(".")
        if url.scheme != "https" or not host or url.username or url.password:
            return False
        if host in {"localhost", "example.com", "example.org", "example.net"}:
            return False
        if host.endswith((".localhost", ".local", ".invalid", ".test",
                          ".example", ".example.com", ".example.org",
                          ".example.net")):
            return False
        if any(x in value.lower() for x in
               ("placeholder", "substituir", "todo", "token=", "password=", "api_key=")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return bool(re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", host))
    except ValueError:
        return False


def utc_review_date(value, now=None):
    if not isinstance(value, str) or not value.endswith("Z"):
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
        current = now or datetime.now(timezone.utc)
        return parsed.tzinfo is not None and parsed <= current and parsed.year >= 2026
    except ValueError:
        return False


def assess_release(gradle: str, manifest: str, evidence: object,
                   now=None, ota_floor=OTA_VERSION_FLOOR) -> list[str]:
    failures = []
    def reject(code, condition):
        if not condition:
            failures.append(code)

    def exact_int(name):
        matches = re.findall(r"^\s*" + re.escape(name) + r"\s*=\s*(\d+)\s*$",
                             gradle, re.M)
        return int(matches[0]) if len(matches) == 1 else None

    code = exact_int("versionCode")
    reject("play_version_must_exceed_reserved_ota_code",
           code is not None and ota_floor < code <= MAX_PLAY_VERSION)
    reject("play_target_sdk_36_required", exact_int("targetSdk") == 36)
    reject("play_package_mismatch",
           len(re.findall(r'^\s*applicationId\s*=\s*"br.com.atriocatolico"\s*$',
                          gradle, re.M)) == 1)
    reject("play_variant_absent", bool(re.search(
        r'create\s*\(\s*"playRelease"\s*\)', gradle)))
    reject("play_distribution_flag_absent",
           bool(re.search(r'buildConfigField\s*\(\s*"boolean"\s*,\s*"PLAY_STORE_BUILD"\s*,\s*"true"\s*\)', gradle)))
    reject("play_install_permission_not_removed",
           bool(re.search(r'android:name\s*=\s*"android.permission.REQUEST_INSTALL_PACKAGES"[^>]*tools:node\s*=\s*"remove"',
                          manifest, re.S)))
    reject("play_ota_provider_not_removed",
           bool(re.search(r'android:name\s*=\s*"androidx.core.content.FileProvider"[^>]*tools:node\s*=\s*"remove"',
                          manifest, re.S)))

    if not isinstance(evidence, dict):
        return failures + ["privacy_manifest_missing_or_invalid"]
    reject("privacy_manifest_schema_or_track",
           evidence.get("schema") == 1 and evidence.get("track") == EXPECTED_TRACK)
    reject("manual_release_authorization_missing",
           evidence.get("releaseAuthorized") is True)
    rows = evidence.get("requirements")
    if not isinstance(rows, dict) or set(rows) != REQUIREMENTS:
        return failures + ["privacy_nine_requirements_missing"]
    for key in sorted(REQUIREMENTS):
        row = rows[key]
        if not isinstance(row, dict) or row.get("verified") is not True:
            failures.append("privacy_unverified:" + key)
            continue
        if not real_https_url(row.get("evidenceUrl")):
            failures.append("privacy_unsafe_evidence_url:" + key)
        reviewer = row.get("reviewedBy")
        if not isinstance(reviewer, str) or not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9_.-]{2,80}", reviewer):
            failures.append("privacy_reviewer_missing:" + key)
        if not utc_review_date(row.get("reviewedAt"), now):
            failures.append("privacy_review_date_invalid:" + key)
    return failures


def inspect(root: Path) -> list[str]:
    gradle = root / "app/build.gradle.kts"
    manifest = root / "app/src/playRelease/AndroidManifest.xml"
    evidence = root / "docs/google-play-privacidade-evidencias.json"
    if not gradle.is_file() or not manifest.is_file():
        return ["play_source_files_missing"]
    if not evidence.is_file():
        return ["privacy_evidence_file_missing"]
    try:
        blockers = assess_release(gradle.read_text(encoding="utf-8"),
                                  manifest.read_text(encoding="utf-8"),
                                  json.loads(evidence.read_text(encoding="utf-8")))
        firebase_file = root / "app/google-services.json"
        if not firebase_file.is_file():
            return blockers + ["play_firebase_config_missing"]
        config = json.loads(firebase_file.read_text(encoding="utf-8"))
        if not isinstance(config, dict):
            return blockers + ["play_firebase_config_invalid"]
        project = config.get("project_info")
        if not isinstance(project, dict) or project.get("project_id") != EXPECTED_FIREBASE_PROJECT:
            blockers.append("play_firebase_wrong_project")
        clients = config.get("client")
        if not isinstance(clients, list) or not any(
                isinstance(c, dict)
                and isinstance(c.get("client_info"), dict)
                and c["client_info"].get("android_client_info", {}).get("package_name") == EXPECTED_PACKAGE
                and bool(c["client_info"].get("mobilesdk_app_id"))
                and bool(c.get("api_key"))
                for c in clients):
            blockers.append("play_firebase_wrong_app")
        return blockers
    except (OSError, ValueError, UnicodeError):
        return ["play_release_sources_unreadable_or_invalid"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true")
    parser.add_argument("--enforce", action="store_true")
    parser.add_argument("--root", type=Path,
                        default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    if args.audit == args.enforce:
        parser.error("escolha exatamente --audit OU --enforce")
    blocked = inspect(args.root)
    print("Play signed AAB preflight:", "BLOQUEADO" if blocked else
          "SEM BLOQUEIOS LOCAIS — REVISAO EXTERNA AINDA OBRIGATORIA")
    for issue in blocked:
        print(" - " + issue)
    if not blocked:
        print("Este exame nao atesta certificado Play, backend, HTTPS real ou Play Console.")
    return 2 if blocked and args.enforce else 0


if __name__ == "__main__":
    raise SystemExit(main())
