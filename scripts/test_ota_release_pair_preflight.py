"""Offline regressions for an official-signer, two-APK Release QA preflight."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.ota_apk_preflight import PreflightError
from scripts.ota_release_cert import PINNED_OFFICIAL_CERT_SHA256
from scripts.ota_release_pair_preflight import verify_release_pair, version_key


class ReleasePairPreflightTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name, "base.apk")
        self.candidate = Path(temp.name, "candidate.apk")
        self.base.write_bytes(b"base APK fixture for isolated policy test")
        self.candidate.write_bytes(b"candidate APK fixture for isolated policy test")
        self.sdk = temp.name
        self.old = {
            "package": "br.com.atriocatolico",
            "certificate_sha256": PINNED_OFFICIAL_CERT_SHA256,
            "versionName": "0.20.1",
            "versionCode": 36,
        }
        self.new = {
            "package": "br.com.atriocatolico",
            "certificate_sha256": PINNED_OFFICIAL_CERT_SHA256,
            "versionName": "0.20.2",
            "versionCode": 37,
        }

    @staticmethod
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def verify(self, *, old=None, new=None, old_sha=None, new_sha=None):
        records = {
            self.base: old if old is not None else self.old,
            self.candidate: new if new is not None else self.new,
        }

        def fake_android_sdk(apk, _sdk):
            return records[Path(apk)]

        with patch("scripts.ota_release_pair_preflight.inspect_apk",
                   side_effect=fake_android_sdk):
            return verify_release_pair(
                self.base, self.candidate,
                base_sha256=old_sha if old_sha is not None else self.digest(self.base),
                candidate_sha256=new_sha if new_sha is not None else self.digest(self.candidate),
                sdk=self.sdk,
            )

    def test_valid_offline_metadata_is_not_homologation_or_publication(self):
        report = self.verify()
        self.assertEqual(report["base"]["versionCode"], 36)
        self.assertEqual(report["candidate"]["versionCode"], 37)
        self.assertEqual(report["official_certificate_sha256"],
                         PINNED_OFFICIAL_CERT_SHA256)
        self.assertFalse(report["physical_ota_homologated"])
        self.assertFalse(report["session_preservation_tested"])
        self.assertFalse(report["release_approved"])
        self.assertFalse(report["published"])

    def test_0200_cannot_act_as_in_app_ota_base(self):
        previous = {**self.old, "versionCode": 35, "versionName": "0.20.0"}
        with self.assertRaisesRegex(PreflightError, "nao possui cliente OTA"):
            self.verify(old=previous)

    def test_identical_or_older_version_code_is_refused(self):
        for code in (35, 36):
            with self.subTest(code=code):
                with self.assertRaisesRegex(PreflightError, "versionCode"):
                    self.verify(new={**self.new, "versionCode": code})

    def test_version_name_must_advance_numerically(self):
        for value in ("0.20.1", "0.19.9", "bad", "0.20.01"):
            with self.subTest(value=value):
                if value == "0.20.01":
                    # Leading zeros remain numerically equal to 0.20.1.
                    pass
                with self.assertRaises(PreflightError):
                    self.verify(new={**self.new, "versionName": value})
        self.assertTrue(version_key("0.20.10") > version_key("0.20.9"))

    def test_other_certificate_cannot_pass_even_if_both_apks_share_it(self):
        other = "f" * 64
        with self.assertRaisesRegex(PreflightError, "Certificado divergente"):
            self.verify(old={**self.old, "certificate_sha256": other},
                        new={**self.new, "certificate_sha256": other})

    def test_candidate_certificate_mismatch_is_refused(self):
        with self.assertRaisesRegex(PreflightError, "Certificado divergente"):
            self.verify(new={**self.new, "certificate_sha256": "a" * 64})

    def test_different_package_is_refused(self):
        with self.assertRaisesRegex(PreflightError, "Pacote"):
            self.verify(new={**self.new, "package": "br.com.estranho"})

    def test_tampered_apk_hash_is_refused(self):
        known = self.digest(self.candidate)
        self.candidate.write_bytes(self.candidate.read_bytes() + b"\0")
        with self.assertRaisesRegex(PreflightError, "SHA-256"):
            self.verify(new_sha=known)

    def test_independent_hashes_required_and_must_differ(self):
        with self.assertRaisesRegex(PreflightError, "SHA-256"):
            self.verify(old_sha="bad")
        with self.assertRaisesRegex(PreflightError, "SHA-256"):
            self.verify(new_sha="a" * 64)

    def test_same_apk_file_is_refused(self):
        with self.assertRaisesRegex(PreflightError, "outro arquivo"):
            verify_release_pair(
                self.base, self.base,
                base_sha256=self.digest(self.base),
                candidate_sha256=self.digest(self.base),
                sdk=self.sdk,
            )

    def test_missing_file_is_refused(self):
        self.candidate.unlink()
        with self.assertRaisesRegex(PreflightError, "devem existir"):
            self.verify()

    def test_changed_during_android_inspection_is_refused(self):
        def changing_sdk(apk, _sdk):
            if Path(apk) == self.candidate:
                self.candidate.write_bytes(b"tampered during inspection")
                return self.new
            return self.old
        with patch("scripts.ota_release_pair_preflight.inspect_apk",
                   side_effect=changing_sdk):
            with self.assertRaisesRegex(PreflightError, "modificado durante"):
                verify_release_pair(
                    self.base, self.candidate,
                    base_sha256=self.digest(self.base),
                    candidate_sha256=self.digest(self.candidate),
                    sdk=self.sdk,
                )


if __name__ == "__main__":
    unittest.main()
