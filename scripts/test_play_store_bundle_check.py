#!/usr/bin/env python3
"""Regressoes offline do verificador do AAB Play: sem Android SDK ou segredos."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

from play_store_bundle_check import (
    ANDROID, EXPECTED_PACKAGE, verify_manifest, verify_bundle,
    verify_play_flag, locate_merged_manifests, main,
)


class PlayBundleSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def manifest(self, package=EXPECTED_PACKAGE, target="36", backup="false",
                 debug="false", cleartext=None, testonly=None, install=None,
                 provider=None, extra_sdk=False):
        root = ET.Element("manifest", {"package": package})
        ET.SubElement(root, "uses-sdk", {ANDROID + "targetSdkVersion": target})
        if extra_sdk:
            ET.SubElement(root, "uses-sdk", {ANDROID + "targetSdkVersion": "35"})
        ET.SubElement(root, "uses-permission", {
            ANDROID + "name": install or "android.permission.INTERNET"
        })
        app_attrs = {ANDROID + "allowBackup": backup, ANDROID + "debuggable": debug}
        if cleartext is not None:
            app_attrs[ANDROID + "usesCleartextTraffic"] = cleartext
        if testonly is not None:
            app_attrs[ANDROID + "testOnly"] = testonly
        app = ET.SubElement(root, "application", app_attrs)
        if provider is not None:
            ET.SubElement(app, "provider", {ANDROID + "name": provider})
        path = self.root / "AndroidManifest.xml"
        ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
        return path

    def bundle(self, include_manifest=True, include_config=True, corrupt=False):
        path = self.root / "app/build/outputs/bundle/playRelease/app-playRelease.aab"
        path.parent.mkdir(parents=True, exist_ok=True)
        if corrupt:
            path.write_bytes(b"not a zip")
        else:
            with zipfile.ZipFile(path, "w") as z:
                if include_manifest:
                    z.writestr("base/manifest/AndroidManifest.xml", b"manifest")
                if include_config:
                    z.writestr("BundleConfig.pb", b"config")
        return path

    def play_flag(self, value="true"):
        path = self.root / "app/build/generated/source/buildConfig/playRelease/x/BuildConfig.java"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("public static final boolean PLAY_STORE_BUILD = " + value + ";")
        return path

    def merged(self):
        path = (self.root /
                "app/build/intermediates/merged_manifest/playRelease/processPlayReleaseMainManifest/AndroidManifest.xml")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.manifest().read_bytes())
        return path

    def test_valid_merged_manifest(self):
        verify_manifest(self.manifest())

    def test_reject_other_application_id(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(package="com.example.other"))

    def test_reject_sdk_downgrade_and_duplicate(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(target="35"))
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(extra_sdk=True))

    def test_reject_install_permission(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(
                install="android.permission.REQUEST_INSTALL_PACKAGES"))

    def test_reject_ota_file_provider(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(
                provider="androidx.core.content.FileProvider"))

    def test_reject_debuggable(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(debug="true"))

    def test_reject_backup_enabled_or_missing(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(backup="true"))
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(backup=""))

    def test_reject_cleartext_and_test_only(self):
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(cleartext="true"))
        with self.assertRaises(AssertionError):
            verify_manifest(self.manifest(testonly="true"))

    def test_valid_bundle_and_missing_parts(self):
        verify_bundle(self.bundle())
        with self.assertRaises(AssertionError):
            verify_bundle(self.bundle(include_config=False))
        with self.assertRaises(AssertionError):
            verify_bundle(self.bundle(include_manifest=False))

    def test_corrupted_bundle(self):
        with self.assertRaises(zipfile.BadZipFile):
            verify_bundle(self.bundle(corrupt=True))

    def test_flag_requires_exactly_one_true_buildconfig(self):
        self.play_flag()
        verify_play_flag(self.root)
        self.play_flag("false")
        with self.assertRaises(AssertionError):
            verify_play_flag(self.root)

    def test_reject_duplicate_play_buildconfig(self):
        self.play_flag()
        duplicate = self.root / "app/build/generated/source/buildConfig/playRelease/y/BuildConfig.java"
        duplicate.parent.mkdir(parents=True, exist_ok=True)
        duplicate.write_text("PLAY_STORE_BUILD = true")
        with self.assertRaises(AssertionError):
            verify_play_flag(self.root)

    def test_merged_manifest_missing_is_blocked(self):
        with self.assertRaises(AssertionError):
            locate_merged_manifests(self.root)

    def test_end_to_end_minimal_valid_fixture(self):
        self.merged()
        self.play_flag()
        self.bundle()
        with unittest.mock.patch.object(sys, "argv", ["play_store_bundle_check.py",
                                                      "--project-root", str(self.root)]):
            self.assertEqual(main(), 0)

    def test_end_to_end_rejects_dangerous_backup(self):
        merged = self.merged()
        merged.write_bytes(self.manifest(backup="true").read_bytes())
        self.play_flag()
        self.bundle()
        with unittest.mock.patch.object(sys, "argv", ["play_store_bundle_check.py",
                                                      "--project-root", str(self.root)]):
            self.assertEqual(main(), 1)

    def test_optimized_python_cli_fails_closed(self):
        script = Path(__file__).with_name("play_store_bundle_check.py")
        p = subprocess.run(
            [sys.executable, "-O", str(script), "--project-root", str(self.root)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(p.returncode, 1)
        self.assertIn("Python otimizado", p.stderr)


if __name__ == "__main__":
    unittest.main()
