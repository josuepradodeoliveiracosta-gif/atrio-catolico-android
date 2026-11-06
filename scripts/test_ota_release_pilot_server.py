"""Tests for the real-certificate, localhost-only OTA Release pilot server."""
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread
import tempfile
import unittest
from unittest.mock import patch

from scripts import ota_release_pilot_server as pilot
from scripts.ota_apk_preflight import PreflightError
from scripts.ota_release_cert import PINNED_OFFICIAL_CERT_SHA256


class PrivateReleasePilotTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.apk = Path(temp.name, "candidate.apk")
        self.apk.write_bytes(b"QA fixture, not real APK")
        self.sdk = Path(temp.name)
        self.metadata = {
            "package": "br.com.atriocatolico",
            "versionName": "0.20.2",
            "versionCode": 37,
            "certificate_sha256": PINNED_OFFICIAL_CERT_SHA256,
        }

    def sha(self):
        return hashlib.sha256(self.apk.read_bytes()).hexdigest()

    def prepare(self, *, metadata=None, sha=None, base_code=36, minimum=b"26"):
        with patch.object(pilot, "inspect_apk", return_value=metadata or self.metadata), \
             patch.object(pilot.subprocess, "check_output", return_value=minimum):
            return pilot.prepare_offer(
                self.apk, sdk=self.sdk,
                expected_sha256=sha if sha is not None else self.sha(),
                base_code=base_code,
            )

    def test_official_cert_and_local_release_contract(self):
        release, manifest = self.prepare()
        self.assertEqual(manifest["applicationId"], "br.com.atriocatolico")
        self.assertEqual(manifest["certificateSha256"], PINNED_OFFICIAL_CERT_SHA256)
        self.assertEqual(manifest["versionCode"], 37)
        self.assertEqual(manifest["channel"], "stable")
        self.assertEqual(manifest["mandatory"], False)
        self.assertEqual(manifest["downloadUrl"],
                         "http://127.0.0.1:8765/releases/download/v0.20.2/atrio-catolico.apk")
        self.assertEqual(release["html_url"], pilot.ORIGIN + "/releases/tag/v0.20.2")
        self.assertEqual(
            {item["name"] for item in release["assets"]},
            {"update.json", "atrio-catolico.apk"},
        )
        self.assertFalse(release["draft"])
        self.assertFalse(release["prerelease"])

    def test_rejects_old_base_and_non_increasing_candidate(self):
        with self.assertRaisesRegex(PreflightError, "code36"):
            self.prepare(base_code=35)
        with self.assertRaisesRegex(PreflightError, "nao supera"):
            self.prepare(base_code=37)

    def test_rejects_tampered_apk(self):
        recorded = self.sha()
        self.apk.write_bytes(b"tampered payload")
        with self.assertRaisesRegex(PreflightError, "SHA-256"):
            self.prepare(sha=recorded)

    def test_rejects_wrong_certificate_and_package(self):
        with self.assertRaisesRegex(PreflightError, "Certificado divergente"):
            self.prepare(metadata={**self.metadata, "certificate_sha256": "f" * 64})
        with self.assertRaisesRegex(PreflightError, "PackageName"):
            self.prepare(metadata={**self.metadata, "package": "br.com.fake"})

    def test_rejects_old_android_sdk(self):
        with self.assertRaisesRegex(PreflightError, "minSdk"):
            self.prepare(minimum=b"23")
        with self.assertRaisesRegex(PreflightError, "minSdk"):
            self.prepare(minimum=b"invalid")

    def test_server_only_serves_immutable_fixed_paths(self):
        release, manifest = self.prepare()
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            pilot.make_handler(self.apk, release, manifest),
        )
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def get(path):
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                try:
                    connection.request("GET", path)
                    response = connection.getresponse()
                    return response.status, response.read()
                finally:
                    connection.close()
            for path in ("/releases/latest",
                         "/releases/download/v0.20.2/update.json"):
                status, body = get(path)
                self.assertEqual(status, 200)
                self.assertIsInstance(json.loads(body), dict)
            status, data = get("/releases/download/v0.20.2/atrio-catolico.apk")
            self.assertEqual(status, 200)
            self.assertEqual(data, self.apk.read_bytes())
            for path in ("/", "/private", "/releases/latest?token=secret",
                         "/../../etc/passwd", "/releases/download/v0.20.3/atrio-catolico.apk"):
                self.assertEqual(get(path)[0], 404)
            self.apk.write_bytes(self.apk.read_bytes() + b"changed")
            self.assertEqual(
                get("/releases/download/v0.20.2/atrio-catolico.apk")[0], 409
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_termux_manifest_requires_exact_contract_and_independent_hash(self):
        _, manifest = self.prepare()
        path = self.sdk / "update.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        _, accepted = pilot.serve_prevalidated_manifest(
            self.apk, manifest_file=path,
            expected_sha256=self.sha(), base_code=36,
        )
        self.assertEqual(accepted, manifest)
        with self.assertRaisesRegex(PreflightError, "SHA-256"):
            pilot.serve_prevalidated_manifest(
                self.apk, manifest_file=path,
                expected_sha256="f" * 64, base_code=36,
            )
        manifest["certificateSha256"] = "f" * 64
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(PreflightError, "Certificado divergente"):
            pilot.serve_prevalidated_manifest(
                self.apk, manifest_file=path,
                expected_sha256=self.sha(), base_code=36,
            )

    def test_termux_manifest_refuses_remote_host_and_version_downgrade(self):
        _, manifest = self.prepare()
        path = self.sdk / "update.json"
        manifest["downloadUrl"] = "http://attacker.invalid/file.apk"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(PreflightError, "Contrato"):
            pilot.serve_prevalidated_manifest(
                self.apk, manifest_file=path,
                expected_sha256=self.sha(), base_code=36,
            )
        manifest["downloadUrl"] = (
            "http://127.0.0.1:8765/releases/download/v0.20.2/atrio-catolico.apk"
        )
        manifest["versionCode"] = 36
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(PreflightError, "Versao"):
            pilot.serve_prevalidated_manifest(
                self.apk, manifest_file=path,
                expected_sha256=self.sha(), base_code=36,
            )

    def test_variant_cannot_bypass_official_signer(self):
        root = Path(__file__).resolve().parents[1]
        signer = (root / "app/src/main/java/br/com/atriocatolico/OtaOfficialSigner.kt").read_text()
        self.assertIn("OtaQaChannel.active || fingerprint.equals(", signer)
        self.assertNotIn("OtaQaChannel.usesLoopback ||", signer)
        gradle = (root / "app/build.gradle.kts").read_text()
        self.assertIn('create("otaPilot")', gradle)
        self.assertIn('buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "true")', gradle)
        self.assertIn('isDebuggable = false', gradle)
        self.assertIn('matchingFallbacks += listOf("release")', gradle)
        self.assertIn('variant.enable = atrioOtaPilotEnabled', gradle)
        self.assertIn('HOMOLOGAR ATRIO SEM PUBLICAR', gradle)
        self.assertIn('ATRIO_SIGNING_STORE_FILE', gradle)
        self.assertNotIn('applicationIdSuffix = ".otapilot"', gradle)

    def test_remote_http_stays_denied_in_pilot_overlay(self):
        root = Path(__file__).resolve().parents[1]
        network = (root / "app/src/otaPilot/res/xml/ota_pilot_network_security.xml").read_text()
        self.assertIn('base-config cleartextTrafficPermitted="false"', network)
        self.assertIn('<domain includeSubdomains="false">127.0.0.1</domain>', network)
        channel = (root / "app/src/main/java/br/com/atriocatolico/OtaQaChannel.kt").read_text()
        self.assertIn('uri.host == "127.0.0.1" && uri.port == 8765', channel)
        self.assertIn('uri.rawQuery == null', channel)
        policy = (root / "app/src/main/java/br/com/atriocatolico/OtaUpdatePolicy.kt").read_text()
        self.assertIn('val PACKAGE: String get() = if (OtaQaChannel.active)', policy)
        self.assertIn('OtaQaChannel.usesLoopback', policy)


if __name__ == "__main__":
    unittest.main()
