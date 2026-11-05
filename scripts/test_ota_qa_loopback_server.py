"""Contrato de origem local OTA: fixtures nunca sao releases publicos."""
import importlib.util
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.request import urlopen

MODULE = Path(__file__).with_name("ota_qa_loopback_server.py")
spec = importlib.util.spec_from_file_location("ota_qa_loopback_server", MODULE)
ota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ota)


class OtaQaLoopbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.apk = Path(self.tmp.name) / "app.apk"
        self.apk.write_bytes(b"TEST FIXTURE NOT AN APK")
        self.metadata = {
            "versionName": "0.19.8",
            "versionCode": 35,
            "minimumAndroidSdk": 26,
            "apkSizeBytes": self.apk.stat().st_size,
            "apkSha256": "f" * 64,
            "certificateSha256": "a" * 64,
        }

    def tearDown(self):
        self.tmp.cleanup()

    def test_manifest_matches_client_contract_and_uses_local_origin(self):
        release, manifest = ota.build_fixture(self.metadata)
        self.assertEqual(ota.PACKAGE, "br.com.atriocatolico.otalab")
        self.assertEqual(manifest["applicationId"], ota.PACKAGE)
        self.assertEqual(release["tag_name"], "v0.19.8")
        self.assertEqual(manifest["versionCode"], 35)
        self.assertEqual(manifest["downloadUrl"],
                         "http://127.0.0.1:8765/releases/download/v0.19.8/atrio-catolico.apk")
        self.assertEqual({x["name"] for x in release["assets"]},
                         {"update.json", "atrio-catolico.apk"})

    def test_invalid_fixtures_do_not_pretend_to_be_valid(self):
        self.assertEqual(ota.build_fixture(self.metadata, fixture_mode="bad-hash")[1]["apkSha256"],
                         "0" * 64)
        self.assertEqual(ota.build_fixture(self.metadata, fixture_mode="bad-cert")[1]["certificateSha256"],
                         "0" * 64)
        self.assertEqual(ota.build_fixture(self.metadata, fixture_mode="downgrade")[1]["versionCode"],
                         1)
        self.assertEqual(
            ota.build_fixture(self.metadata, fixture_mode="truncated-apk")[1],
            ota.build_fixture(self.metadata, fixture_mode="valid")[1],
        )
        with self.assertRaises(ValueError):
            ota.build_fixture(self.metadata, fixture_mode="unsupported")

    def test_server_only_exposes_fixed_paths(self):
        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(self.apk, release, manifest)
        # Porta aleatoria somente no unittest; o servidor real fixa 127.0.0.1:8765.
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = "http://127.0.0.1:" + str(server.server_port)
        try:
            with urlopen(base + "/releases/latest") as response:
                data = json.load(response)
            self.assertEqual(data["tag_name"], "v0.19.8")
            with urlopen(base + "/releases/download/v0.19.8/atrio-catolico.apk") as response:
                self.assertEqual(response.read(), self.apk.read_bytes())
            with self.assertRaises(Exception):
                urlopen(base + "/private")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


    def test_truncated_body_declares_full_size_but_ends_early(self):
        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(
            self.apk, release, manifest, fixture_mode="truncated-apk"
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = (
            f"http://127.0.0.1:{server.server_port}/releases/download/"
            "v0.19.8/atrio-catolico.apk"
        )
        try:
            with urlopen(url) as response:
                self.assertEqual(response.headers["Content-Length"], str(self.apk.stat().st_size))
                with self.assertRaises(IncompleteRead):
                    response.read()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)



if __name__ == "__main__":
    unittest.main()
