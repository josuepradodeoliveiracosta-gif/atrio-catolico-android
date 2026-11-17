"""Fixtures de saída e código de retorno do apksigner, sem material de assinatura."""

import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.ota_apk_preflight import PreflightError
from scripts.qa_geral_celular_signature import main, verify_signature


REFERENCE = "ab" * 32
OTHER = "cd" * 32
SINGLE_SIGNER = f"Verifies\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: {REFERENCE}\n"


class QaGeralCelularSignatureTest(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.apk = Path(directory.name) / "fixture.apk"
        self.apk.write_bytes(b"apk fixture")
        self.apksigner = Path(directory.name) / "apksigner"

    def test_accepts_one_verified_signer_with_reference(self):
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, SINGLE_SIGNER)) as run:
            verify_signature(self.apk, self.apksigner, REFERENCE.upper())
        run.assert_called_once_with(
            [str(self.apksigner), "verify", "--verbose", "--print-certs", str(self.apk.resolve())],
            check=True, text=True, capture_output=True,
        )

    def test_rejects_unsigned_or_invalid_apk_even_with_matching_stdout(self):
        for status, output in ((1, ""), (1, SINGLE_SIGNER)):
            with self.subTest(output=output), patch(
                "subprocess.run", side_effect=subprocess.CalledProcessError(status, [], output=output)
            ):
                with self.assertRaises(PreflightError):
                    verify_signature(self.apk, self.apksigner, REFERENCE)

    def test_rejects_other_certificate(self):
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, SINGLE_SIGNER)):
            with self.assertRaisesRegex(PreflightError, "diverge"):
                verify_signature(self.apk, self.apksigner, OTHER)

    def test_rejects_extra_signer_even_if_its_certificate_matches(self):
        extra_digest = f"Signer #2 certificate SHA-256 digest: {REFERENCE}\n"
        for output in (SINGLE_SIGNER.replace("signers: 1", "signers: 2"), SINGLE_SIGNER):
            with self.subTest(output=output), patch(
                "subprocess.run", return_value=subprocess.CompletedProcess([], 0, output + extra_digest)
            ):
                with self.assertRaises(PreflightError):
                    verify_signature(self.apk, self.apksigner, REFERENCE)

    def test_rejects_incomplete_or_malformed_verifier_output(self):
        outputs = (
            "Verifies\nNumber of signers: 1",
            f"Signer #1 certificate SHA-256 digest: {REFERENCE}",
            SINGLE_SIGNER.replace("#1", "#2"),
            SINGLE_SIGNER.replace(REFERENCE, REFERENCE + "a"),
        )
        for output in outputs:
            with self.subTest(output=output), patch(
                "subprocess.run", return_value=subprocess.CompletedProcess([], 0, output)
            ):
                with self.assertRaises(PreflightError):
                    verify_signature(self.apk, self.apksigner, REFERENCE)

    def test_rejects_missing_reference_and_apk_before_invoking_verifier(self):
        with patch("subprocess.run") as run:
            for reference in ("", "not-a-fingerprint"):
                with self.subTest(reference=reference), self.assertRaisesRegex(PreflightError, "referência"):
                    verify_signature(self.apk, self.apksigner, reference)
            with self.assertRaisesRegex(PreflightError, "APK ausente"):
                verify_signature(self.apk.with_name("missing.apk"), self.apksigner, REFERENCE)
        run.assert_not_called()

    def test_cli_blocks_without_reference_from_environment(self):
        args = ["qa_geral_celular_signature", "--apk", str(self.apk), "--apksigner", str(self.apksigner)]
        with patch.object(sys, "argv", args), patch.dict(os.environ, {"ATRIO_QA_CELULAR_CERT_SHA256": ""}):
            with patch("subprocess.run") as run, patch("sys.stderr"):
                self.assertEqual(1, main())
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
