#!/usr/bin/env python3
"""Offline QA for Play App Signing continuity, independent of upload certificates."""
import contextlib
import io
import os
import unittest
from unittest import mock

from play_app_signing_continuity import app_signing_continuity, main

PLAY = "c3" * 32
FORMATTED = ":".join(PLAY[i:i + 2] for i in range(0, 64, 2)).upper()


class AppSigningContinuityTests(unittest.TestCase):
    def test_exact_public_cert_match_in_hex_and_colon_formats(self):
        self.assertTrue(app_signing_continuity(PLAY, FORMATTED))
        self.assertTrue(app_signing_continuity(FORMATTED, PLAY))

    def test_missing_values_fail_closed(self):
        for play, installed in [(None, PLAY), (PLAY, None), ("", PLAY), (PLAY, "")]:
            with self.subTest(play=bool(play), installed=bool(installed)):
                with self.assertRaisesRegex(ValueError, "missing_or_invalid"):
                    app_signing_continuity(play, installed)

    def test_malformed_values_fail_closed(self):
        for invalid in ["bad", "AB" * 31, "0x" + PLAY, ":" * 31, "X" * 64]:
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "missing_or_invalid"):
                    app_signing_continuity(invalid, PLAY)

    def test_valid_but_different_certificates_rejected(self):
        with self.assertRaisesRegex(ValueError, "cert_mismatch_existing_apk"):
            app_signing_continuity(PLAY, "ef" * 32)

    def test_upload_certificate_is_not_substitute_for_app_signing(self):
        with mock.patch.dict(os.environ, {"ATRIO_PLAY_UPLOAD_CERT_SHA256": PLAY}, clear=True):
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(), 2)

    def test_cli_blocks_missing_or_mismatched_and_accepts_only_explicit_proof(self):
        with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(), 2)
        with mock.patch.dict(os.environ, {
            "ATRIO_PLAY_APP_SIGNING_CERT_SHA256": PLAY,
            "ATRIO_INSTALLED_APK_CERT_SHA256": "ef" * 32,
        }, clear=True), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(), 2)
        with mock.patch.dict(os.environ, {
            "ATRIO_PLAY_APP_SIGNING_CERT_SHA256": PLAY,
            "ATRIO_INSTALLED_APK_CERT_SHA256": FORMATTED,
        }, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)


if __name__ == "__main__":
    unittest.main()
