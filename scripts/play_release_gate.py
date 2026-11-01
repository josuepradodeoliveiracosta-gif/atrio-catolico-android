#!/usr/bin/env python3
"""Preflight local, sem rede e sem segredos, para AAB Play assinado.

Nao prova que o app cumpre a Play: evidencia e assinatura exigem revisao externa.
Nunca modifica versoes, arquivos, variaveis, permissoes ou chaves.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import ipaddress
import os
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

EXPECTED_PACKAGE = "br.com.atriocatolico"
EXPECTED_FIREBASE_PROJECT = "atrio-catolico"
EXPECTED_TRACK = "Google Play — testes fechados"
OTA_VERSION_FLOOR = 36  # Candidato OTA 0.20.1 da PR #70; rever com o proximo OTA.
MAX_PLAY_VERSION = 2_100_000_000
UGC_REQUIREMENTS = frozenset({
    "terms_accepted_before_ugc", "report_content_and_users",
    "block_users", "moderation_actions", "push_block_safe_delivery",
    "closed_track_ugc_e2e"
})
POST_TRACK_PRIVACY = "closed_track_e2e"
POST_TRACK_UGC = "closed_track_ugc_e2e"
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
                   now=None, ota_floor=OTA_VERSION_FLOOR,
                   ugc_evidence=None) -> list[str]:
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

    def reviewed_row(row, prefix, key, required):
        # Antes do PRIMEIRO envio nao ha instalacao na faixa fechada.
        # QA em dispositivo via Play so sera possivel apos o primeiro AAB.
        if not isinstance(row, dict) or not isinstance(row.get("verified"), bool):
            failures.append(prefix + "_invalid:" + key)
            return
        if row["verified"] is not True:
            if required:
                failures.append(prefix + "_unverified:" + key)
            if any(row.get(field) is not None for field in
                   ("evidenceUrl", "reviewedBy", "reviewedAt")):
                failures.append(prefix + "_pending_with_fake_review:" + key)
            return
        if not real_https_url(row.get("evidenceUrl")):
            failures.append(prefix + "_unsafe_evidence_url:" + key)
        reviewer = row.get("reviewedBy")
        if not isinstance(reviewer, str) or not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9_.-]{2,80}", reviewer):
            failures.append(prefix + "_reviewer_missing:" + key)
        if not utc_review_date(row.get("reviewedAt"), now):
            failures.append(prefix + "_review_date_invalid:" + key)

    if not isinstance(evidence, dict):
        failures.append("privacy_manifest_missing_or_invalid")
    else:
        reject("privacy_manifest_schema_or_track",
               evidence.get("schema") == 1 and evidence.get("track") == EXPECTED_TRACK)
        rows = evidence.get("requirements")
        if not isinstance(rows, dict) or set(rows) != REQUIREMENTS:
            failures.append("privacy_nine_requirements_missing")
        else:
            for key in sorted(REQUIREMENTS):
                reviewed_row(rows[key], "privacy", key, key != POST_TRACK_PRIVACY)
            if evidence.get("releaseAuthorized") is True and any(
                    not isinstance(row, dict) or row.get("verified") is not True
                    for row in rows.values()):
                failures.append("privacy_premature_release_authorization")
        # AAB assinado nao significa publicacao e tampouco autoriza producao.
        reject("privacy_release_authorization_type_invalid",
               type(evidence.get("releaseAuthorized")) is bool)
    if not isinstance(ugc_evidence, dict):
        failures.append("ugc_evidence_missing")
    else:
        reject("ugc_manifest_schema_or_track",
               ugc_evidence.get("schema") == 1
               and ugc_evidence.get("track") == EXPECTED_TRACK)
        ugc_rows = ugc_evidence.get("requirements")
        if not isinstance(ugc_rows, dict) or set(ugc_rows) != UGC_REQUIREMENTS:
            failures.append("ugc_requirements_missing")
        else:
            for key in sorted(UGC_REQUIREMENTS):
                reviewed_row(ugc_rows[key], "ugc", key, key != POST_TRACK_UGC)
    return failures

def inspect(root: Path) -> list[str]:
    """Audit every independent preflight prerequisite, never short-circuiting on
    absent evidence. A missing document must not conceal unrelated blockers.
    This function is strictly read-only and does not authorize signing.
    """
    blockers = []
    gradle = root / "app/build.gradle.kts"
    manifest = root / "app/src/playRelease/AndroidManifest.xml"
    source = None
    if not gradle.is_file() or not manifest.is_file():
        blockers.append("play_source_files_missing")
    else:
        try:
            source = (gradle.read_text(encoding="utf-8"),
                      manifest.read_text(encoding="utf-8"))
        except (OSError, UnicodeError):
            blockers.append("play_release_sources_unreadable_or_invalid")

    def read_evidence(path: Path, missing: str, invalid: str):
        if not path.is_file():
            blockers.append(missing)
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                blockers.append(invalid)
                return None
            return data
        except (OSError, ValueError, UnicodeError):
            blockers.append(invalid)
            return None

    privacy_file = root / "docs/google-play-privacidade-evidencias.json"
    ugc_file = root / "docs/google-play-ugc-evidencias.json"
    privacy = read_evidence(privacy_file, "privacy_evidence_file_missing",
                            "privacy_evidence_invalid")
    ugc = read_evidence(ugc_file, "ugc_evidence_file_missing",
                        "ugc_evidence_invalid")
    if source is not None:
        source_blockers = assess_release(source[0], source[1], privacy,
                                         ugc_evidence=ugc)
        # Dedicated file diagnostics take precedence over generic missing/invalid
        # manifest diagnostics, keeping one actionable error per file.
        if privacy is None:
            source_blockers = [b for b in source_blockers
                               if b != "privacy_manifest_missing_or_invalid"]
        if ugc is None:
            source_blockers = [b for b in source_blockers
                               if b != "ugc_evidence_missing"]
        blockers.extend(source_blockers)

    firebase_file = root / "app/google-services.json"
    if not firebase_file.is_file():
        blockers.append("play_firebase_config_missing")
    else:
        try:
            config = json.loads(firebase_file.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError):
            config = None
        if not isinstance(config, dict):
            blockers.append("play_firebase_config_invalid")
        else:
            project = config.get("project_info")
            if not isinstance(project, dict) or project.get("project_id") != EXPECTED_FIREBASE_PROJECT:
                blockers.append("play_firebase_wrong_project")
            clients = config.get("client")

            def valid_client(c):
                if not isinstance(c, dict) or not isinstance(c.get("client_info"), dict):
                    return False
                info = c["client_info"]
                android = info.get("android_client_info")
                keys = c.get("api_key")
                return (isinstance(android, dict)
                        and android.get("package_name") == EXPECTED_PACKAGE
                        and bool(info.get("mobilesdk_app_id"))
                        and isinstance(keys, list)
                        and any(isinstance(k, dict) and bool(k.get("current_key"))
                                for k in keys))
            if not isinstance(clients, list) or not any(valid_client(c) for c in clients):
                blockers.append("play_firebase_wrong_app")
    return blockers

def privacy_policy_link_blockers(root: Path, url: str) -> list[str]:
    """Confirma somente a configuracao/local do link. Nao prova URL publicada.

    O HTTPS real e o conteudo juridico exigem verificacao humana no navegador.
    Esta checagem acontece antes de abrir o keystore da assinatura.
    """
    failures = []
    if not real_https_url(url):
        failures.append("play_public_privacy_policy_url_missing_or_invalid")
    else:
        try:
            parsed = urlsplit(url)
            invalid = bool(parsed.query or parsed.fragment or parsed.port not in (None, 443))
        except ValueError:
            invalid = True
        if invalid:
            failures.append("play_privacy_policy_url_must_be_static_https")
    try:
        gradle = (root / "app/build.gradle.kts").read_text(encoding="utf-8")
        profile = (root / "app/src/main/java/br/com/atriocatolico/ProfileScreen.kt").read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return failures + ["play_privacy_policy_ui_source_missing"]
    if 'buildConfigField("String", "PRIVACY_POLICY_URL"' not in gradle:
        failures.append("play_privacy_policy_buildconfig_missing")
    if ("BuildConfig.PRIVACY_POLICY_URL" not in profile or
            'testTag("atrio-profile-privacy-policy")' not in profile):
        failures.append("play_privacy_policy_link_in_app_missing")
    return failures


def account_deletion_portal_blockers(root: Path, url: str) -> list[str]:
    """Pre-signature gate for the *separate* Google Play deletion web URL.

    Deliberately fail closed until the repository's portal has undergone
    explicit code review and has been enabled. Static checks are not evidence
    that the HTTPS site is deployed or that an actual deletion succeeds.
    """
    failures = []
    if not real_https_url(url):
        failures.append("play_deletion_portal_url_missing_or_invalid")
    else:
        try:
            parsed = urlsplit(url)
            invalid = bool(parsed.query or parsed.fragment or
                           parsed.port not in (None, 443))
        except ValueError:
            invalid = True
        if invalid:
            failures.append("play_deletion_portal_url_must_be_static_https")
    portal = root / "cloudflare/account-deletion-portal/public/app.js"
    try:
        source = portal.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        failures.append("play_deletion_portal_source_missing")
        return failures
    # Merely passing a URL, setting an environment variable or forging a
    # manifest cannot bypass this deliberate source-code release interlock.
    if not re.search(
        r"(?m)^\s*const LIVE_INTAKE_REVIEWED_AND_APPROVED\s*=\s*true\s*;",
        source
    ):
        failures.append("play_deletion_portal_intake_not_approved")
    if ("window.ATRIO_PORTAL_STATUS?.intakeEnabled===true" not in source or
            "window.ATRIO_PORTAL_STATUS?.actualDeletionEnabled===true" not in source):
        failures.append("play_deletion_portal_backend_fence_missing")
    return failures


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
    blocked.extend(privacy_policy_link_blockers(
        args.root, os.environ.get("ATRIO_PRIVACY_POLICY_URL", "")))
    blocked.extend(account_deletion_portal_blockers(
        args.root, os.environ.get("ATRIO_DELETION_PORTAL_URL", "")))
    print("Play closed-track AAB pre-signature preflight:", "BLOQUEADO" if blocked else
          "SEM BLOQUEIOS LOCAIS — REVISAO EXTERNA AINDA OBRIGATORIA")
    for issue in blocked:
        print(" - " + issue)
    if not blocked:
        print("Sem bloqueios LOCAIS de pre-assinatura; isto NAO autoriza upload, testes ou producao. E2E da faixa fechada continua pos-envio.")
    return 2 if blocked and args.enforce else 0


if __name__ == "__main__":
    raise SystemExit(main())
