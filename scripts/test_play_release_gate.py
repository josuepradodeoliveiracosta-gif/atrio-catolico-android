#!/usr/bin/env python3
"""Regressoes offline do gate do AAB: nenhuma chave/endpoint acessada."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
import unittest

from play_release_gate import (
    assess_release, inspect, real_https_url, utc_review_date, REQUIREMENTS
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


class ReleaseGateTests(unittest.TestCase):
    def audit(self, gradle=GRADLE, manifest=MANIFEST, record=None):
        return assess_release(gradle, manifest, evidence() if record is None
                              else record, now=NOW)

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

    def test_manual_authorization_is_not_substitute_for_evidence(self):
        record = evidence()
        record["releaseAuthorized"] = False
        self.assertIn("manual_release_authorization_missing",
                      self.audit(record=record))

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
            self.assertEqual(inspect(root), ["privacy_evidence_file_missing"])

    def test_invalid_manifest_json_blocks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "app/src/playRelease").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "app/build.gradle.kts").write_text(GRADLE)
            (root / "app/src/playRelease/AndroidManifest.xml").write_text(MANIFEST)
            (root / "docs/google-play-privacidade-evidencias.json").write_text("{invalid")
            self.assertEqual(inspect(root),
                             ["play_release_sources_unreadable_or_invalid"])


if __name__ == "__main__":
    unittest.main()
