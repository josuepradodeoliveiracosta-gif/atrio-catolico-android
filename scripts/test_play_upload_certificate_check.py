#!/usr/bin/env python3
"""Offline regression fixtures for the upload certificate SHA-256 gate."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from play_upload_certificate_check import normalize_fingerprint, verify_certificate_der, main

CERT = bytes.fromhex("30820100") + bytes(range(128))
DIGEST = hashlib.sha256(CERT).hexdigest()


class UploadCertificateGateTests(unittest.TestCase):
    def test_accepts_expected_digest_in_both_formats(self):
        self.assertTrue(verify_certificate_der(CERT, DIGEST))
        formatted = ":".join(DIGEST[i:i+2] for i in range(0, 64, 2)).upper()
        self.assertTrue(verify_certificate_der(CERT, formatted))
        self.assertEqual(normalize_fingerprint(formatted), DIGEST)

    def test_wrong_cert_fails_even_with_valid_syntax(self):
        self.assertFalse(verify_certificate_der(CERT, "a"*64))
        self.assertFalse(verify_certificate_der(CERT+b"x", DIGEST))

    def test_rejects_missing_and_malformed_expected_values(self):
        for value in [None, "", "abc", "a"*63, "a"*65, ":".join(["a"]*32),
                      "AA:"+"b"*62, "0x"+"a"*64, ":".join(["GG"]*32)]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_fingerprint(value)

    def test_rejects_non_der_or_unreasonably_large_certificate(self):
        for blob in [b"", b"0", b"---PEM---"+b"X"*80, b"X"*200, b"\x30"+b"x"*65536]:
            with self.subTest(length=len(blob)):
                with self.assertRaises(ValueError):
                    verify_certificate_der(blob, DIGEST)

    def test_cli_fails_closed_if_expected_missing_or_mismatched(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"public.der"
            path.write_bytes(CERT)
            with mock.patch.dict(os.environ, {}, clear=True):
                self.assertEqual(main(["--certificate", str(path)]), 2)
            with mock.patch.dict(os.environ, {"ATRIO_PLAY_UPLOAD_CERT_SHA256": "0"*64}):
                self.assertEqual(main(["--certificate", str(path)]), 2)
            with mock.patch.dict(os.environ, {"ATRIO_PLAY_UPLOAD_CERT_SHA256": DIGEST}):
                self.assertEqual(main(["--certificate", str(path)]), 0)

    def test_missing_file_denied_even_with_valid_expected(self):
        with mock.patch.dict(os.environ, {"ATRIO_PLAY_UPLOAD_CERT_SHA256": DIGEST}):
            self.assertEqual(main(["--certificate", "/does-not-exist/fake.der"]), 2)


if __name__ == "__main__":
    unittest.main()
