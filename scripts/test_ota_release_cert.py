"""No-secret regression checks for official OTA signing certificate continuity."""
import tempfile
import unittest
from pathlib import Path

from scripts.ota_apk_preflight import PreflightError
from scripts.ota_release_cert import (
    PINNED_OFFICIAL_CERT_SHA256, require_official_certificate,
    verify_existing_signed_apk,
)


class ReleaseCertificateContinuityTests(unittest.TestCase):
    def test_expected_historical_certificate_is_accepted(self):
        self.assertEqual(
            require_official_certificate(PINNED_OFFICIAL_CERT_SHA256),
            PINNED_OFFICIAL_CERT_SHA256,
        )
        formatted = ":".join(
            PINNED_OFFICIAL_CERT_SHA256[i:i+2]
            for i in range(0, 64, 2)
        ).upper()
        self.assertEqual(
            require_official_certificate(formatted), PINNED_OFFICIAL_CERT_SHA256
        )

    def test_different_certificate_or_malformed_hash_is_rejected(self):
        for candidate in ("f" * 64, "0" * 64, "", "wrong", "a" * 63):
            with self.subTest(candidate=candidate):
                with self.assertRaises(PreflightError):
                    require_official_certificate(candidate)

    def test_existing_apk_is_inspected_and_wrong_signer_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp, "existing-signed.apk")
            apk.write_bytes(b"an APK fixture: tool responses stubbed")
            called = []

            def stub(argv):
                called.append(argv)
                if "apksigner" in argv[0]:
                    return (
                        "Signer #1 certificate SHA-256 digest: "
                        + PINNED_OFFICIAL_CERT_SHA256
                    )
                field = argv[2]
                return {
                    "application-id": "br.com.atriocatolico",
                    "version-code": "35",
                    "version-name": "0.20.0",
                    "debuggable": "false",
                }[field]

            facts = verify_existing_signed_apk(apk, sdk=temp, runner=stub)
            self.assertEqual(facts["certificate_sha256"], PINNED_OFFICIAL_CERT_SHA256)
            self.assertEqual(facts["versionCode"], 35)
            self.assertEqual(facts["package"], "br.com.atriocatolico")
            self.assertEqual(len(called), 5)

            def wrong_cert(argv):
                result = stub(argv)
                if "apksigner" in argv[0]:
                    return result.replace(PINNED_OFFICIAL_CERT_SHA256, "f" * 64)
                return result

            with self.assertRaisesRegex(PreflightError, "Certificado divergente"):
                verify_existing_signed_apk(apk, sdk=temp, runner=wrong_cert)

            apk.write_bytes(b"")
            with self.assertRaisesRegex(PreflightError, "ausente ou vazio"):
                verify_existing_signed_apk(apk, sdk=temp, runner=stub)

    def test_multi_signer_or_wrong_package_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp, "apk")
            apk.write_bytes(b"fixture")
            def stub(argv):
                if "apksigner" in argv[0]:
                    return (
                        "Signer #1 certificate SHA-256 digest: "
                        + PINNED_OFFICIAL_CERT_SHA256 + "\n"
                        "Signer #2 certificate SHA-256 digest: "
                        + PINNED_OFFICIAL_CERT_SHA256
                    )
                return "br.com.atriocatolico"
            with self.assertRaisesRegex(PreflightError, "unico assinante"):
                verify_existing_signed_apk(apk, sdk=temp, runner=stub)

    def test_signing_and_publication_paths_invoke_the_guard(self):
        root = Path(__file__).resolve().parents[1]
        build = (root / ".github/workflows/build-apk.yml").read_text()
        publish = (root / "scripts/ota_release.py").read_text()
        guard = "python3 scripts/ota_release_cert.py"
        self.assertIn(guard, build)
        self.assertLess(build.index("gradle :app:assembleRelease"), build.index(guard))
        self.assertLess(
            build.index(guard),
            build.index("- name: Disponibilizar APK com assinatura permanente"),
        )
        self.assertIn("from scripts.ota_release_cert import require_official_certificate", publish)
        self.assertIn("cert = require_official_certificate(expected_certificate)", publish)


if __name__ == "__main__":
    unittest.main()
