#!/usr/bin/env python3
"""Regressoes offline do gate do AAB: nenhuma chave/endpoint acessada."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from play_release_gate import (
    assess_release, inspect, real_https_url, utc_review_date, REQUIREMENTS, UGC_REQUIREMENTS
)

GRADLE = '''
android {
 defaultConfig {
    applicationId = "br.com.atriocatolico"
    targetSdk = 36
    versionCode = 37
 }
 buildTypes {
    create("playRelease") {
      buildConfigField("boolean", "PLAY_STORE_BUILD", "true")
    }
 }
}
'''
MANIFEST = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
 xmlns:tools="http://schemas.android.com/tools">
 <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" tools:node="remove"/>
 <application><provider android:name="androidx.core.content.FileProvider" tools:node="remove"/></application>
</manifest>'''
NOW = datetime(2026, 10, 31, tzinfo=timezone.utc)


def evidence():
    return {
        "schema": 1,
        "track": "Google Play — testes fechados",
        "releaseAuthorized": True,
        "requirements": {
            name: {
                "verified": True,
                "evidenceUrl": "https://github.com/atrio/audit/issues/123",
                "reviewedBy": "revisor.qa",
                "reviewedAt": "2026-10-30T15:30:00Z"
            }
            for name in REQUIREMENTS
        }
    }


def ugc_evidence():
    return {
        "schema": 1,
        "track": "Google Play — testes fechados",
        "requirements": {
            name: {
                "verified": True,
                "evidenceUrl": "https://github.com/atrio/audit/issues/124",
                "reviewedBy": "revisor.qa",
                "reviewedAt": "2026-10-30T15:30:00Z"
            }
            for name in UGC_REQUIREMENTS
        }
    }


class ReleaseGateTests(unittest.TestCase):
    def audit(self, gradle=GRADLE, manifest=MANIFEST, record=None):
        return assess_release(gradle, manifest, evidence() if record is None
                              else record, now=NOW, ugc_evidence=ugc_evidence())

    def test_only_clean_synthetic_fixture_passes_local_checks(self):
        self.assertEqual(self.audit(), [])

    def test_reserved_ota_code_36_not_allowed(self):
        for code in (34, 35, 36, 2100000001):
            with self.subTest(code=code):
                self.assertIn("play_version_must_exceed_reserved_ota_code",
                              self.audit(gradle=GRADLE.replace("versionCode = 37",
                                                              f"versionCode = {code}")))

    def test_duplicate_version_declarations_fail_closed(self):
        text = GRADLE.replace("versionCode = 37",
                              "versionCode = 37\n    versionCode = 38")
        self.assertIn("play_version_must_exceed_reserved_ota_code",
                      self.audit(gradle=text))

    def test_sdk_35_rejected(self):
        self.assertIn("play_target_sdk_36_required",
                      self.audit(gradle=GRADLE.replace("targetSdk = 36", "targetSdk = 35")))

    def test_play_variant_or_flag_missing(self):
        self.assertIn("play_variant_absent",
                      self.audit(gradle=GRADLE.replace('create("playRelease")',
                                                      'create("release")')))
        self.assertIn("play_distribution_flag_absent",
                      self.audit(gradle=GRADLE.replace('"true"', '"false"')))

    def test_ota_permission_or_provider_leak_rejected(self):
        self.assertIn("play_install_permission_not_removed",
                      self.audit(manifest=MANIFEST.replace('tools:node="remove"', '', 1)))
        self.assertIn("play_ota_provider_not_removed",
                      self.audit(manifest=MANIFEST.replace(
                          'androidx.core.content.FileProvider" tools:node="remove"',
                          'androidx.core.content.FileProvider"')))

    def test_unverified_item_never_passes(self):
        record = evidence()
        record["requirements"]["deletion_executor"]["verified"] = False
        self.assertIn("privacy_unverified:deletion_executor",
                      self.audit(record=record))

    def test_pre_signature_can_keep_release_authorization_false(self):
        record = evidence()
        record["releaseAuthorized"] = False
        record["requirements"]["closed_track_e2e"] = {
            "description": "pos-primeiro-AAB", "verified": False,
            "evidenceUrl": None, "reviewedBy": None, "reviewedAt": None
        }
        self.assertEqual(self.audit(record=record), [])

    def test_release_authorization_cannot_precede_closed_track_e2e(self):
        record = evidence()
        record["releaseAuthorized"] = True
        record["requirements"]["closed_track_e2e"] = {
            "description": "pos-primeiro-AAB", "verified": False,
            "evidenceUrl": None, "reviewedBy": None, "reviewedAt": None
        }
        self.assertIn("privacy_premature_release_authorization", self.audit(record=record))

    def test_ugc_pre_signature_is_mandatory_but_ugc_device_e2e_is_after_upload(self):
        ugc = ugc_evidence()
        ugc["requirements"]["closed_track_ugc_e2e"] = {
            "verified": False, "evidenceUrl": None,
            "reviewedBy": None, "reviewedAt": None
        }
        self.assertEqual(assess_release(GRADLE, MANIFEST, evidence(),
                                        now=NOW, ugc_evidence=ugc), [])
        ugc["requirements"]["block_users"]["verified"] = False
        self.assertIn("ugc_unverified:block_users",
                      assess_release(GRADLE, MANIFEST, evidence(),
                                     now=NOW, ugc_evidence=ugc))
        ugc = ugc_evidence()
        ugc["requirements"]["push_block_safe_delivery"]["verified"] = False
        self.assertIn("ugc_unverified:push_block_safe_delivery",
                      assess_release(GRADLE, MANIFEST, evidence(),
                                     now=NOW, ugc_evidence=ugc))

    def test_ugc_missing_or_malformed_rejected(self):
        self.assertIn("ugc_evidence_missing",
                      assess_release(GRADLE, MANIFEST, evidence(), now=NOW))
        ugc = ugc_evidence()
        ugc["requirements"].pop("block_users")
        self.assertIn("ugc_requirements_missing",
                      assess_release(GRADLE, MANIFEST, evidence(),
                                     now=NOW, ugc_evidence=ugc))

    def test_extra_or_missing_requirements_rejected(self):
        record = evidence()
        del record["requirements"]["worker_freeze"]
        self.assertIn("privacy_nine_requirements_missing",
                      self.audit(record=record))

    def test_fake_or_local_urls_rejected(self):
        for url in ("https://example.com/evidence",
                    "https://audit.example.com/evidence",
                    "https://localhost/audit", "https://127.0.0.1/audit",
                    "https://10.20.30.40/audit", "https://file.invalid/",
                    "http://github.com/a", "https://user:pass@github.com/a",
                    "https://github.com/a?token=123", "https://github.com/TODO"):
            with self.subTest(url=url):
                self.assertFalse(real_https_url(url))
                record = evidence()
                record["requirements"]["data_safety"]["evidenceUrl"] = url
                self.assertIn("privacy_unsafe_evidence_url:data_safety",
                              self.audit(record=record))

    def test_future_and_non_utc_approval_rejected(self):
        for stamp in ("2099-01-01T00:00:00Z", "2026-10-30T00:00:00+00:00",
                      "2026-15-01T00:00:00Z", "", None):
            with self.subTest(stamp=stamp):
                self.assertFalse(utc_review_date(stamp, NOW))
                record = evidence()
                record["requirements"]["operational_security"]["reviewedAt"] = stamp
                self.assertIn("privacy_review_date_invalid:operational_security",
                              self.audit(record=record))

    def test_blank_reviewer_rejected(self):
        record = evidence()
        record["requirements"]["retention_review"]["reviewedBy"] = " "
        self.assertIn("privacy_reviewer_missing:retention_review",
                      self.audit(record=record))

    def test_missing_evidence_file_blocks_even_when_source_ok(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            blockers = inspect(root)
            self.assertIn("privacy_evidence_file_missing", blockers)
            self.assertIn("ugc_evidence_file_missing", blockers)
            self.assertIn("play_firebase_config_missing", blockers)
            self.assertNotIn("play_source_files_missing", blockers)

    def test_play_bundle_requires_official_firebase_project_and_app(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            (root / "docs/google-play-privacidade-evidencias.json").write_text(
                json.dumps(evidence()))
            blockers = inspect(root)
            self.assertIn("ugc_evidence_file_missing", blockers)
            self.assertIn("play_firebase_config_missing", blockers)
            self.assertNotIn("privacy_evidence_file_missing", blockers)
            (root / "docs/google-play-ugc-evidencias.json").write_text(
                json.dumps(ugc_evidence()))
            self.assertIn("play_firebase_config_missing", inspect(root))
            firebase = {
                "project_info": {"project_id": "atrio-catolico"},
                "client": [{
                    "client_info": {
                        "android_client_info": {"package_name": "br.com.atriocatolico"},
                        "mobilesdk_app_id": "1:qa:android:fixture"
                    },
                    "api_key": [{"current_key": "fixture-not-a-secret"}]
                }]
            }
            firebase_path = root / "app/google-services.json"
            firebase_path.write_text(json.dumps(firebase))
            self.assertEqual(inspect(root), [])
            firebase["project_info"]["project_id"] = "demo-project"
            firebase_path.write_text(json.dumps(firebase))
            self.assertIn("play_firebase_wrong_project", inspect(root))
            firebase["project_info"]["project_id"] = "atrio-catolico"
            firebase["client"][0]["client_info"]["android_client_info"]["package_name"] = "com.other.app"
            firebase_path.write_text(json.dumps(firebase))
            self.assertIn("play_firebase_wrong_app", inspect(root))

    def test_invalid_manifest_json_blocks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            (root / "docs/google-play-privacidade-evidencias.json").write_text("{invalid")
            (root / "docs/google-play-ugc-evidencias.json").write_text(
                json.dumps(ugc_evidence()))
            blockers = inspect(root)
            self.assertIn("privacy_evidence_invalid", blockers)
            self.assertIn("play_firebase_config_missing", blockers)
            self.assertNotIn("ugc_evidence_invalid", blockers)


    def test_audit_reports_independent_missing_prerequisites(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            blockers = inspect(root)
            self.assertEqual(blockers, [
                "play_source_files_missing",
                "privacy_evidence_file_missing",
                "ugc_evidence_file_missing",
                "play_firebase_config_missing",
            ])

    def test_privacy_missing_does_not_hide_ugc_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            record = ugc_evidence()
            record["requirements"]["block_users"]["verified"] = False
            (root / "docs/google-play-ugc-evidencias.json").write_text(json.dumps(record))
            blockers = inspect(root)
            self.assertIn("privacy_evidence_file_missing", blockers)
            self.assertIn("ugc_unverified:block_users", blockers)
            self.assertIn("play_firebase_config_missing", blockers)

    def test_ugc_invalid_does_not_hide_privacy_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            record = evidence()
            record["requirements"]["worker_freeze"]["verified"] = False
            (root / "docs/google-play-privacidade-evidencias.json").write_text(json.dumps(record))
            (root / "docs/google-play-ugc-evidencias.json").write_text("{broken")
            blockers = inspect(root)
            self.assertIn("ugc_evidence_invalid", blockers)
            self.assertIn("privacy_unverified:worker_freeze", blockers)
            self.assertNotIn("ugc_evidence_missing", blockers)

    def test_json_null_and_list_evidence_cannot_bypass_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            (root / "docs/google-play-privacidade-evidencias.json").write_text("null")
            (root / "docs/google-play-ugc-evidencias.json").write_text("[]")
            blockers = inspect(root)
            self.assertIn("privacy_evidence_invalid", blockers)
            self.assertIn("ugc_evidence_invalid", blockers)

    def test_invalid_firebase_reports_its_own_code(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app").mkdir()
            (root / "app/google-services.json").write_text("{broken")
            blockers = inspect(root)
            self.assertIn("play_firebase_config_invalid", blockers)
            self.assertNotIn("play_firebase_config_missing", blockers)


class PrivacyPolicyLinkTests(unittest.TestCase):
    def test_signed_aab_requires_real_https_link_and_in_app_access(self):
        from play_release_gate import privacy_policy_link_blockers
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/main/java/br/com/atriocatolico").mkdir(parents=True)
            (root / "app/build.gradle.kts").write_text(
                'buildConfigField("String", "PRIVACY_POLICY_URL", "\\"$policyUrl\\"")')
            profile = root / "app/src/main/java/br/com/atriocatolico/ProfileScreen.kt"
            profile.write_text('BuildConfig.PRIVACY_POLICY_URL testTag("atrio-profile-privacy-policy")')
            valid = "https://atrio-catolico.org.br/politica-de-privacidade"
            self.assertEqual(privacy_policy_link_blockers(root, valid), [])
            for url in ("", "http://atrio-catolico.org.br/politica",
                        "https://example.com/politica",
                        "https://atrio-catolico.org.br/politica?token=abc",
                        "https://atrio-catolico.org.br:porta/politica"):
                with self.subTest(url=url):
                    self.assertTrue(privacy_policy_link_blockers(root, url))
            profile.write_text("sem link")
            self.assertIn("play_privacy_policy_link_in_app_missing",
                          privacy_policy_link_blockers(root, valid))


class AccountDeletionPortalGateTests(unittest.TestCase):
    def test_separate_external_url_and_approved_intake_are_required(self):
        from play_release_gate import account_deletion_portal_blockers
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            portal = root / "cloudflare/account-deletion-portal/public/app.js"
            portal.parent.mkdir(parents=True)
            builder = root / "cloudflare/account-deletion-portal/scripts/build.mjs"
            builder.parent.mkdir(parents=True)
            builder.write_text(
                "JSON.stringify({intakeEnabled:false,actualDeletionEnabled:false})",
                encoding="utf-8"
            )
            canonical = (
                "const LIVE_INTAKE_REVIEWED_AND_APPROVED=false;\n"
                "const intakeEnabled=LIVE_INTAKE_REVIEWED_AND_APPROVED &&\n"
                "  window.ATRIO_PORTAL_STATUS?.intakeEnabled===true &&\n"
                "  window.ATRIO_PORTAL_STATUS?.actualDeletionEnabled===true;\n"
            )
            portal.write_text(canonical, encoding="utf-8")
            valid = "https://exclusao.atrio-catolico.org.br/solicitar"
            self.assertIn(
                "play_deletion_portal_intake_not_approved",
                account_deletion_portal_blockers(root, valid)
            )
            for url in (
                "", "http://exclusao.atrio-catolico.org.br/",
                "https://example.org/solicitar",
                "https://localhost/solicitar",
                "https://exclusao.atrio-catolico.org.br:444/solicitar",
                "https://exclusao.atrio-catolico.org.br/solicitar?token=abc",
                "https://exclusao.atrio-catolico.org.br/solicitar#login"
            ):
                with self.subTest(url=url):
                    self.assertTrue(account_deletion_portal_blockers(root, url))
            # Only a deliberate, reviewed code change may unlock the
            # static interlock; it still requires external deploy evidence.
            portal.write_text(canonical.replace(
                "LIVE_INTAKE_REVIEWED_AND_APPROVED=false;",
                "LIVE_INTAKE_REVIEWED_AND_APPROVED=true;"
            ), encoding="utf-8")
            self.assertIn(
                "play_deletion_portal_generated_config_not_approved",
                account_deletion_portal_blockers(root, valid)
            )
            builder.write_text(
                "JSON.stringify({intakeEnabled:true,actualDeletionEnabled:false})",
                encoding="utf-8"
            )
            self.assertIn(
                "play_deletion_portal_generated_config_not_approved",
                account_deletion_portal_blockers(root, valid)
            )
            builder.write_text(
                "JSON.stringify({intakeEnabled:true,actualDeletionEnabled:true})",
                encoding="utf-8"
            )
            self.assertEqual(account_deletion_portal_blockers(root, valid), [])
            builder.write_text(
                "JSON.stringify({intakeEnabled:true,actualDeletionEnabled:true})\n"
                "JSON.stringify({intakeEnabled:false,actualDeletionEnabled:false})",
                encoding="utf-8"
            )
            self.assertIn(
                "play_deletion_portal_generated_config_not_approved",
                account_deletion_portal_blockers(root, valid)
            )
            builder.write_text(
                "JSON.stringify({intakeEnabled:true,actualDeletionEnabled:true})",
                encoding="utf-8"
            )
            portal.write_text(
                "const LIVE_INTAKE_REVIEWED_AND_APPROVED=true;",
                encoding="utf-8"
            )
            self.assertIn(
                "play_deletion_portal_backend_fence_missing",
                account_deletion_portal_blockers(root, valid)
            )
            portal.unlink()
            self.assertIn(
                "play_deletion_portal_source_missing",
                account_deletion_portal_blockers(root, valid)
            )
            portal.write_text(canonical.replace(
                "LIVE_INTAKE_REVIEWED_AND_APPROVED=false;",
                "LIVE_INTAKE_REVIEWED_AND_APPROVED=true;"
            ), encoding="utf-8")
            builder.unlink()
            self.assertIn(
                "play_deletion_portal_builder_missing",
                account_deletion_portal_blockers(root, valid)
            )



class ManualSupportDeletionGateTests(unittest.TestCase):
    """Synthetic configuration tests, not published web or real inbox proof."""

    def setUp(self):
        from play_release_gate import deletion_web_blockers
        self.check = deletion_web_blockers
        self.root = Path(__file__).resolve().parents[1]
        self.valid = dict(
            mode="manual-support",
            email="atendimento@atrio-catolico.org",
            privacy_url="https://atrio-catolico.org/privacidade",
            reviewed="manual-support-and-privacy-reviewed",
            monitored="true",
        )

    def test_static_manual_support_path_has_separate_explicit_gates(self):
        self.assertEqual(self.check(
            self.root, "https://atrio-catolico.org/excluir-conta", **self.valid), [])

    def test_no_contact_no_legal_review_or_unmonitored_inbox_stays_blocked(self):
        cases = [
            ({"email": ""}, "play_support_contact_email_missing_or_invalid"),
            ({"email": "support@example.com"}, "play_support_email_placeholder_or_unsafe"),
            ({"email": "a@host.org\nBcc:bad@host.org"},
             "play_support_contact_email_missing_or_invalid"),
            ({"reviewed": ""}, "play_support_operational_and_legal_review_required"),
            ({"monitored": "false"}, "play_support_monitored_mailbox_required"),
            ({"privacy_url": ""}, "play_support_privacy_policy_required"),
        ]
        for mutation, required in cases:
            with self.subTest(mutation=mutation):
                blockers = self.check(
                    self.root, "https://atrio-catolico.org/excluir-conta",
                    **{**self.valid, **mutation}
                )
                self.assertIn(required, blockers)

    def test_fake_or_insecure_page_address_not_accepted(self):
        for address in ("", "http://atrio-catolico.org/excluir",
                        "https://example.com", "https://atrio-catolico.org/excluir?token=a",
                        "https://atrio-catolico.org/excluir#private"):
            with self.subTest(address=address):
                self.assertNotEqual(self.check(self.root, address, **self.valid), [])

    def test_unknown_mode_never_defaults_to_unreviewed_support(self):
        self.assertEqual(self.check(
            self.root, "https://atrio-catolico.org/excluir-conta",
            **{**self.valid, "mode": "anything-else"}),
            ["play_deletion_web_mode_unapproved"])
        # Default still uses existing locked Firebase portal, NOT support mode.
        self.assertIn("play_deletion_portal_intake_not_approved",
                      self.check(self.root, "https://atrio-catolico.org/excluir-conta"))


class CloudflareQaUrlMustNotBecomePlayUrlTests(unittest.TestCase):
    def test_reserved_qa_project_cannot_be_considered_public_release_evidence(self):
        self.assertFalse(real_https_url(
            "https://atrio-catolico-privacidade-qa.pages.dev/"))
        self.assertFalse(real_https_url(
            "https://atrio-catolico-privacidade-qa.pages.dev/excluir-conta"))
        self.assertTrue(real_https_url("https://sites.atrio.org/privacidade"))


class InAppExternalDeletionLinkTests(unittest.TestCase):
    """Only source inspection, no user devices or external sites touched."""

    def test_real_android_source_has_web_link_and_failure_fallbacks(self):
        from play_release_gate import account_deletion_in_app_link_blockers
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(account_deletion_in_app_link_blockers(root), [])

    def test_missing_implementation_is_never_silently_approved(self):
        from play_release_gate import account_deletion_in_app_link_blockers
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code = root / "app/src/main/java/br/com/atriocatolico"
            code.mkdir(parents=True)
            gradle = root / "app/build.gradle.kts"
            ui = code / "AccountDeletionRequestSection.kt"
            self.assertIn("source_missing",
                          account_deletion_in_app_link_blockers(root)[0])
            gradle.write_text("android {}")
            ui.write_text('Button() { Text("excluir") }')
            failures = account_deletion_in_app_link_blockers(root)
            self.assertIn("play_external_deletion_link_buildconfig_missing", failures)
            self.assertIn("play_external_deletion_link_in_app_missing", failures)
            self.assertIn("play_external_deletion_link_failure_states_missing", failures)

    def test_in_app_link_cannot_be_substituted_with_unrelated_uri(self):
        from play_release_gate import account_deletion_in_app_link_blockers
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code = root / "app/src/main/java/br/com/atriocatolico"
            code.mkdir(parents=True)
            gradle = root / "app/build.gradle.kts"
            ui = code / "AccountDeletionRequestSection.kt"
            gradle.write_text('System.getenv("ATRIO_DELETION_PORTAL_URL") ' +
                              'buildConfigField("String", "DELETION_WEB_URL", "test")')
            ui.write_text('BuildConfig.DELETION_WEB_URL.isNotBlank() ' +
                          'uriHandler.openUri("https://other.example") ' +
                          'testTag("atrio-deletion-web-open") ' +
                          'atrio-deletion-web-pending atrio-deletion-web-fallback')
            failures = account_deletion_in_app_link_blockers(root)
            self.assertIn("play_external_deletion_link_in_app_missing", failures)


class CommunityTermsGateTests(unittest.TestCase):
    def test_public_versioned_community_terms_required_for_signing(self):
        from play_release_gate import community_terms_gate
        root = Path(__file__).resolve().parents[1]
        url = "https://app.atrio-catolico.org/termos/community-v1"
        self.assertEqual(community_terms_gate(root, url, "community-v1"), [])
        for bad in ("", "http://app.atrio-catolico.org/termos",
                    "https://example.com/termos",
                    "https://atrio-catolico-privacidade-qa.pages.dev/termos",
                    url + "?uid=alice"):
            with self.subTest(url=bad):
                self.assertTrue(community_terms_gate(root, bad, "community-v1"))
        for version in ("", "ugc-v1", "community-v0", "community-v01", "community-v10000"):
            with self.subTest(version=version):
                self.assertIn("play_community_terms_version_missing_or_invalid",
                              community_terms_gate(root, url, version))

    def test_missing_sources_cannot_be_approved_by_url_alone(self):
        from play_release_gate import community_terms_gate
        with tempfile.TemporaryDirectory() as tmp:
            errors = community_terms_gate(
                Path(tmp), "https://app.atrio-catolico.org/termos", "community-v1")
            self.assertEqual(sum("source_missing" in issue for issue in errors), 4)


class PlayPushPrivacyGateTests(unittest.TestCase):
    """Synthetic regression fixtures, never send FCM or contact Cloudflare."""

    def setUp(self):
        from play_release_gate import play_push_privacy_blockers
        self.check = play_push_privacy_blockers
        self.root = Path(__file__).resolve().parents[1]
        self.sources = (
            "app/src/main/java/br/com/atriocatolico/AtrioPushService.kt",
            "app/src/main/java/br/com/atriocatolico/ThreadPushSubscriptions.kt",
            "app/src/main/java/br/com/atriocatolico/PlayBroadcastDeliveryPolicy.kt",
            "cloudflare/push-worker/src/index.js"
        )

    def test_current_sources_keep_release_interlock(self):
        self.assertEqual(self.check(self.root), [])

    def test_unavailable_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(len(self.check(Path(tmp))), len(self.sources))

    def test_unsafe_play_topic_or_untargeted_broadcast_regressions_fail(self):
        originals = {
            path: (self.root / path).read_text(encoding="utf-8")
            for path in self.sources
        }
        scenarios = (
            (self.sources[0], "PlayBroadcastDeliveryPolicy.accepts(",
             "true(", "play_push_client_may_accept_legacy_topics"),
            (self.sources[0], "unsubscribeFromTopic(COMMUNICATION_TOPIC)",
             "subscribeToTopic(COMMUNICATION_TOPIC)",
             "play_push_client_may_accept_legacy_topics"),
            (self.sources[1], "unsubscribeAll(context, uid)",
             "// no unsubscription", "play_push_discussion_topic_migration_missing"),
            (self.sources[2], 'destinationUid != currentUid',
             'false', "play_push_per_recipient_client_guard_missing"),
            (self.sources[2], 'sender.orEmpty().startsWith("/topics/")',
             'false', "play_push_per_recipient_client_guard_missing"),
            (self.sources[3], "'broadcast_privacy_coordinator_required'",
             "'broadcast_ready'", "play_push_server_broadcast_privacy_fence_missing"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for path, source in originals.items():
                dest = root / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(source, encoding="utf-8")
            self.assertEqual(self.check(root), [])
            for path, old, replacement, expected in scenarios:
                with self.subTest(path=path, mutation=old):
                    self.assertIn(old, originals[path])
                    dest = root / path
                    dest.write_text(originals[path].replace(old, replacement, 1),
                                    encoding="utf-8")
                    self.assertIn(expected, self.check(root))
                    dest.write_text(originals[path], encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
