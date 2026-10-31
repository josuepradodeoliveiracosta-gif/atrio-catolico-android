"""Offline unit tests: no Android SDK, Firebase, secrets or APK distribution."""
import hashlib
from pathlib import Path
import tempfile
import unittest

from scripts.ota_apk_preflight import PreflightError, digest, verify

CERT = "ab" * 32


class FakeAndroid:
    def __init__(self, *, wrong_signer=False, debug=False, old_cert=CERT, old_code=34):
        self.wrong_signer = wrong_signer
        self.debug = debug
        self.old_cert = old_cert
        self.old_code = old_code

    def __call__(self, args):
        command, apk = args[0], args[-1]
        old = Path(apk).name == "old.apk"
        if command.endswith("/apksigner"):
            cert = self.old_cert if old else ("cd" * 32 if self.wrong_signer else CERT)
            return "Signer #1 certificate SHA-256 digest: " + cert
        field = args[2]
        return {
            "application-id": "br.com.atriocatolico",
            "version-code": str(self.old_code if old else 35),
            "version-name": "0.19.7" if old else "0.20.0",
            "debuggable": "true" if self.debug else "false",
        }[field]


class OtaPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.apk = root / "new.apk"
        self.apk.write_bytes(b"representacao-de-apk")
        self.old = root / "old.apk"
        self.old.write_bytes(b"representacao-de-apk-antigo")
        self.kwargs = {
            "sdk": "/sdk", "expected_cert": CERT,
            "expected_code": 35, "expected_name": "0.20.0",
        }

    def test_valid_new_apk(self):
        result = verify(self.apk, **self.kwargs, runner=FakeAndroid())
        self.assertEqual(result["versionCode"], 35)
        self.assertEqual(result["compatibility_with_previous"], "not_tested")
        self.assertEqual(result["apk_sha256"], hashlib.sha256(self.apk.read_bytes()).hexdigest())

    def test_previous_compatible_apk(self):
        result = verify(self.apk, **self.kwargs, previous_apk=self.old,
                        runner=FakeAndroid())
        self.assertEqual(result["compatibility_with_previous"], "verified")

    def test_migration_required_for_different_previous_certificate(self):
        with self.assertRaisesRegex(PreflightError, "migracao necessaria"):
            verify(self.apk, **self.kwargs, previous_apk=self.old,
                   runner=FakeAndroid(old_cert="ef" * 32))

    def test_reject_wrong_new_certificate(self):
        with self.assertRaisesRegex(PreflightError, "Assinatura"):
            verify(self.apk, **self.kwargs, runner=FakeAndroid(wrong_signer=True))

    def test_reject_debuggable_build(self):
        with self.assertRaisesRegex(PreflightError, "depuravel"):
            verify(self.apk, **self.kwargs, runner=FakeAndroid(debug=True))

    def test_reject_non_increasing_version_code(self):
        with self.assertRaisesRegex(PreflightError, "versionCode maior"):
            verify(self.apk, **self.kwargs, previous_apk=self.old,
                   runner=FakeAndroid(old_code=35))

    def test_reject_wrong_expected_version(self):
        with self.assertRaisesRegex(PreflightError, "Versao do APK"):
            verify(self.apk, **{**self.kwargs, "expected_code": 36}, runner=FakeAndroid())

    def test_reject_wrong_expected_apk_hash(self):
        with self.assertRaisesRegex(PreflightError, "Hash do APK"):
            verify(self.apk, **self.kwargs, expected_apk_sha256="00" * 32,
                   runner=FakeAndroid())

    def test_refuse_unpinned_certificate(self):
        with self.assertRaises(PreflightError):
            digest("")
        with self.assertRaises(PreflightError):
            digest("abcdef")


if __name__ == "__main__":
    unittest.main()
