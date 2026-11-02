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
# Reserved Cloudflare Pages QA project is deliberately NOT the Play listing URL.
# Project creation without an actual deployment does not satisfy Google Play.
QA_DELETION_WEB_HOST = "atrio-catolico-privacidade-qa.pages.dev"
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
        if host in {"localhost", "example.com", "example.org", "example.net",
                    QA_DELETION_WEB_HOST}:
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

    # Important: the HTML/JS approval above is NOT sufficient. The site
    # generator currently emits config.js with BOTH availability flags false.
    # Require explicit review of the generated runtime state as well.
    build_script = root / "cloudflare/account-deletion-portal/scripts/build.mjs"
    try:
        builder = build_script.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        failures.append("play_deletion_portal_builder_missing")
        return failures
    # Restrict this check to the concrete static object used by this project.
    # No environment variable alone can enable the deployed intake.
    generated_states = re.findall(
        r"JSON\.stringify\(\{\s*intakeEnabled:\s*(true|false)\s*,"
        r"\s*actualDeletionEnabled:\s*(true|false)\s*\}\)",
        builder,
    )
    if generated_states != [("true", "true")]:
        failures.append("play_deletion_portal_generated_config_not_approved")
    return failures




def account_deletion_in_app_link_blockers(root: Path) -> list[str]:
    """Require a usable in-app link to the external deletion resource.

    This is a structural check, NOT proof that a site is live or an
    administrative deletion executor exists.
    """
    gradle = root / "app/build.gradle.kts"
    section = root / "app/src/main/java/br/com/atriocatolico/AccountDeletionRequestSection.kt"
    try:
        g = gradle.read_text(encoding="utf-8")
        ui = section.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ["play_external_deletion_link_ui_source_missing"]
    failures = []
    if ('System.getenv("ATRIO_DELETION_PORTAL_URL")' not in g or
        'buildConfigField("String", "DELETION_WEB_URL"' not in g):
        failures.append("play_external_deletion_link_buildconfig_missing")
    if ('BuildConfig.DELETION_WEB_URL.isNotBlank()' not in ui or
        'uriHandler.openUri(BuildConfig.DELETION_WEB_URL)' not in ui or
        'testTag("atrio-deletion-web-open")' not in ui):
        failures.append("play_external_deletion_link_in_app_missing")
    if ("atrio-deletion-web-pending" not in ui or
        "atrio-deletion-web-fallback" not in ui):
        failures.append("play_external_deletion_link_failure_states_missing")
    return failures


def manual_deletion_support_blockers(root: Path, url: str, email: str,
                                     policy_url: str, reviewed: str,
                                     monitored: str) -> list[str]:
    """Alternative Google Play-compliant external request via public support.

    Strictly STATIC preflight. A working inbox, public deployment, identity
    verification, timely actual deletion and legal retention need separately
    reviewed evidence. This never signs, deploys, or calls the inbox.
    """
    failures = []
    if not real_https_url(url):
        failures.append("play_support_web_url_missing_or_invalid")
    else:
        u = urlsplit(url)
        if u.query or u.fragment or u.port not in (None, 443):
            failures.append("play_support_web_url_must_be_static_https")
    if (not isinstance(email, str) or len(email) > 254 or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9.-]+", email)):
        failures.append("play_support_contact_email_missing_or_invalid")
    else:
        domain = email.rsplit("@", 1)[1].lower()
        if (domain in {"example.com", "example.net", "example.org"} or
                domain.endswith((".invalid", ".test", ".local", ".localhost",
                                 ".example", ".example.com", ".example.org",
                                 ".example.net")) or
                not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}",
                                 domain)):
            failures.append("play_support_email_placeholder_or_unsafe")
    if not real_https_url(policy_url):
        failures.append("play_support_privacy_policy_required")
    if reviewed != "manual-support-and-privacy-reviewed":
        failures.append("play_support_operational_and_legal_review_required")
    if monitored != "true":
        failures.append("play_support_monitored_mailbox_required")
    builder = root / "cloudflare/account-deletion-support/build.mjs"
    tests = root / "cloudflare/account-deletion-support/build.test.mjs"
    try:
        source = builder.read_text(encoding="utf-8")
        checks = tests.read_text(encoding="utf-8")
        if not all(token in source for token in (
                "validatedPublicContact", "renderSupportPage", "mailto:",
                "manual-support-and-privacy-reviewed", "Não envie senhas")) or \
                "missing approval" not in checks:
            failures.append("play_support_source_not_verified")
    except (OSError, UnicodeError):
        failures.append("play_support_source_or_tests_missing")
    return failures


def deletion_web_blockers(root: Path, url: str, mode: str = "firebase",
                          email: str = "", privacy_url: str = "",
                          reviewed: str = "", monitored: str = "") -> list[str]:
    if mode == "firebase":
        return account_deletion_portal_blockers(root, url)
    if mode == "manual-support":
        return manual_deletion_support_blockers(
            root, url, email, privacy_url, reviewed, monitored)
    return ["play_deletion_web_mode_unapproved"]

def community_terms_gate(root: Path, url: str, version: str) -> list[str]:
    """Fail-closed local pre-signature check. Published page verified separately."""
    errors = []
    if not real_https_url(url):
        errors.append("play_community_terms_url_missing_or_invalid")
    else:
        try:
            parsed = urlsplit(url)
            if parsed.query or parsed.fragment or parsed.port not in (None, 443):
                errors.append("play_community_terms_url_not_static_https")
        except ValueError:
            errors.append("play_community_terms_url_not_static_https")
    if not isinstance(version, str) or not re.fullmatch(r"community-v[1-9][0-9]{0,3}", version):
        errors.append("play_community_terms_version_missing_or_invalid")
    checks = {
        "app/src/main/java/br/com/atriocatolico/CommunityTermsConsent.kt":
            ("app_config/community_terms", "acceptedTerms", "CommunityTermsPolicy"),
        "app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt":
            ("rememberCommunityTermsStatus", "communityTerms.canPublish"),
        "cloudflare/account-deletion-support/community-terms.mjs":
            ("community-terms-owner-and-legal-reviewed",
             "Termos de Uso e Política da Comunidade"),
        "cloudflare/account-deletion-support/community-terms.test.mjs":
            ("community-v1", "reviewed")
    }
    for path, tokens in checks.items():
        try:
            content = (root / path).read_text(encoding="utf-8")
            if not all(token in content for token in tokens):
                errors.append("play_community_terms_integration_missing:" + path)
        except (OSError, UnicodeError):
            errors.append("play_community_terms_source_missing:" + path)
    return errors


def play_push_privacy_blockers(root: Path) -> list[str]:
    """Static regression interlock for Play FCM routing, before opening a JKS.

    The Worker currently FAILS CLOSED for general broadcasts. In particular,
    source changes cannot be confused with approval to deploy it, and this
    check does not prove the remote Worker is updated or FCM delivery safe.
    """
    sources = {
        "app/src/main/java/br/com/atriocatolico/AtrioPushService.kt":
            "play_broadcast_client",
        "app/src/main/java/br/com/atriocatolico/ThreadPushSubscriptions.kt":
            "play_discussion_topics",
        "app/src/main/java/br/com/atriocatolico/PlayBroadcastDeliveryPolicy.kt":
            "play_broadcast_delivery_policy",
        "cloudflare/push-worker/src/index.js":
            "play_broadcast_worker",
        "app/src/main/java/br/com/atriocatolico/PushSettings.kt":
            "play_fcm_diagnostic_ui",
        "app/src/main/java/br/com/atriocatolico/PushRegistrationDiagnostic.kt":
            "play_fcm_diagnostic_policy",
    }
    files = {}
    errors = []
    for path, code in sources.items():
        try:
            files[code] = (root / path).read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            errors.append("play_push_source_missing_or_unreadable:" + path)
    if "play_broadcast_client" in files:
        text = files["play_broadcast_client"]
        # Scope the unsubscribe check to the Play registration branch.
        # Generic deactivation/unregister helpers also unsubscribe and must
        # not mask a regression in the Play-specific registration path.
        registration = text.split('} else if (result.isSuccessful) {', 1)
        play_registration = (registration[1].split('} else {', 1)[0]
                             if len(registration) == 2 else '')
        checks = (
            'if (BuildConfig.PLAY_STORE_BUILD) {' in play_registration,
            'unsubscribeFromTopic(COMMUNICATION_TOPIC)' in play_registration,
            'PlayBroadcastDeliveryPolicy.accepts(' in text,
            'destinationUid = message.data["uid"]' in text,
            'sender = message.from' in text,
            'addressedTo = message.to' in text,
            'if (BuildConfig.PLAY_STORE_BUILD) return' in text,
        )
        if not all(checks):
            errors.append("play_push_client_may_accept_legacy_topics")
    if "play_discussion_topics" in files:
        text = files["play_discussion_topics"]
        if not all((
            "if (BuildConfig.PLAY_STORE_BUILD)" in text,
            "unsubscribeAll(context, uid)" in text,
            "&& !BuildConfig.PLAY_STORE_BUILD" in text
        )):
            errors.append("play_push_discussion_topic_migration_missing")
    if "play_broadcast_delivery_policy" in files:
        text = files["play_broadcast_delivery_policy"]
        if not all((
            'destinationUid != currentUid' in text,
            'sender.orEmpty().startsWith("/topics/")' in text,
            'addressedTo.orEmpty().startsWith("/topics/")' in text
        )):
            errors.append("play_push_per_recipient_client_guard_missing")
    if "play_fcm_diagnostic_ui" in files:
        text = files["play_fcm_diagnostic_ui"]
        if not all((
            "if (active && !BuildConfig.PLAY_STORE_BUILD)" in text,
            text.count("mayUseFcmTokenDiagnostics(") >= 2,
            "return@addOnCompleteListener" in text
        )):
            errors.append("play_push_device_token_diagnostic_exposed")
    if "play_fcm_diagnostic_policy" in files:
        text = files["play_fcm_diagnostic_policy"]
        if not all((
            "internal fun mayUseFcmTokenDiagnostics(" in text,
            "!playStoreBuild" in text,
            "authenticatedUid == expectedUid" in text,
            "enabledOnDevice" in text
        )):
            errors.append("play_push_device_token_session_guard_missing")
    if "play_broadcast_worker" in files:
        text = files["play_broadcast_worker"]
        start = text.find("export async function handleBroadcast(request, env) {")
        end = text.find("\n// Estatística horária", start) if start >= 0 else -1
        broadcast = text[start:end] if start >= 0 and end > start else ""
        if not (re.search(
                r"return\s+response\(503,\s*'broadcast_privacy_coordinator_required'\)",
                broadcast) and
                "message:{topic:" not in broadcast and
                "messages:send" not in broadcast):
            errors.append("play_push_server_broadcast_privacy_fence_missing")
    return errors


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
    blocked.extend(community_terms_gate(
        args.root, os.environ.get("ATRIO_PLAY_COMMUNITY_TERMS_URL", ""),
        os.environ.get("ATRIO_PLAY_COMMUNITY_TERMS_VERSION", "")))
    blocked.extend(account_deletion_in_app_link_blockers(args.root))
    blocked.extend(play_push_privacy_blockers(args.root))
    blocked.extend(deletion_web_blockers(
        args.root, os.environ.get("ATRIO_DELETION_PORTAL_URL", ""),
        mode=os.environ.get("ATRIO_PLAY_DELETION_MODE", "firebase"),
        email=os.environ.get("ATRIO_PLAY_SUPPORT_EMAIL", ""),
        privacy_url=os.environ.get("ATRIO_PRIVACY_POLICY_URL", ""),
        reviewed=os.environ.get("ATRIO_PLAY_SUPPORT_REVIEWED", ""),
        monitored=os.environ.get("ATRIO_PLAY_SUPPORT_MAILBOX_MONITORED", "")))
    print("Play closed-track AAB pre-signature preflight:", "BLOQUEADO" if blocked else
          "SEM BLOQUEIOS LOCAIS — REVISAO EXTERNA AINDA OBRIGATORIA")
    for issue in blocked:
        print(" - " + issue)
    if not blocked:
        print("Sem bloqueios LOCAIS de pre-assinatura; isto NAO autoriza upload, testes ou producao. E2E da faixa fechada continua pos-envio.")
    return 2 if blocked and args.enforce else 0


if __name__ == "__main__":
    raise SystemExit(main())
