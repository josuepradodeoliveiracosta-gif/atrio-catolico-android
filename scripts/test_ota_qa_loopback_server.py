"""Contrato de origem local OTA: fixtures nunca sao releases publicos."""
import importlib.util
from http.client import HTTPConnection, IncompleteRead
import io
import json
from pathlib import Path
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
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
        self.assertEqual(
            ota.build_fixture(self.metadata, fixture_mode="slow-apk")[1],
            ota.build_fixture(self.metadata, fixture_mode="valid")[1],
        )
        self.assertEqual(
            ota.build_fixture(self.metadata, fixture_mode="truncated-once")[1],
            ota.build_fixture(self.metadata, fixture_mode="valid")[1],
        )
        self.assertEqual(
            ota.build_fixture(self.metadata, fixture_mode="api-unavailable-once")[1],
            ota.build_fixture(self.metadata, fixture_mode="valid")[1],
        )
        for mode in ("manifest-redirect-external", "apk-redirect-external"):
            self.assertEqual(
                ota.build_fixture(self.metadata, fixture_mode=mode),
                ota.build_fixture(self.metadata, fixture_mode="valid"),
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



    def test_truncated_first_download_succeeds_on_retry_without_manifest_change(self):
        self.apk.write_bytes(b"OTA QA RETRY " * 8_000)
        self.metadata["apkSizeBytes"] = self.apk.stat().st_size
        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(
            self.apk, release, manifest, fixture_mode="truncated-once"
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        url = base + "/releases/download/v0.19.8/atrio-catolico.apk"
        try:
            with urlopen(base + "/releases/download/v0.19.8/update.json") as response:
                self.assertEqual(json.load(response)["apkSizeBytes"], self.apk.stat().st_size)
            with urlopen(url) as response:
                self.assertEqual(
                    response.headers["Content-Length"], str(self.apk.stat().st_size)
                )
                with self.assertRaises(IncompleteRead):
                    response.read()
            # A mesma URL deve entregar o arquivo completo na proxima tentativa,
            # sem mudar o manifesto, certificado ou versao anunciada.
            with urlopen(url) as response:
                self.assertEqual(response.read(), self.apk.read_bytes())
            with urlopen(base + "/releases/download/v0.19.8/update.json") as response:
                self.assertEqual(json.load(response), manifest)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


    def test_first_latest_query_returns_503_then_recovers_without_changing_assets(self):
        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(
            self.apk, release, manifest, fixture_mode="api-unavailable-once"
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        latest = base + "/releases/latest"
        try:
            with self.assertRaises(HTTPError) as response:
                urlopen(latest)
            self.assertEqual(response.exception.code, 503)
            # O primeiro 503 deve atingir SOMENTE latest. Outros assets,
            # incluindo o manifesto, permanecem corretos e imutaveis.
            with urlopen(base + "/releases/download/v0.19.8/update.json") as response:
                self.assertEqual(json.load(response), manifest)
            with urlopen(latest) as response:
                self.assertEqual(json.load(response), release)
            with urlopen(latest) as response:
                self.assertEqual(json.load(response), release)
            with urlopen(base + "/releases/download/v0.19.8/atrio-catolico.apk") as response:
                self.assertEqual(response.read(), self.apk.read_bytes())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_external_redirects_only_apply_to_chosen_asset(self):
        release, manifest = ota.build_fixture(self.metadata)
        tag = release["tag_name"]
        cases = (
            ("manifest-redirect-external", "update.json",
             "https://untrusted.invalid/update.json"),
            ("apk-redirect-external", "atrio-catolico.apk",
             "https://untrusted.invalid/atrio-catolico.apk"),
        )
        for mode, asset, outside in cases:
            with self.subTest(mode=mode):
                handler = ota.make_handler(
                    self.apk, release, manifest, fixture_mode=mode
                )
                server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                    try:
                        connection.request(
                            "GET", f"/releases/download/{tag}/{asset}"
                        )
                        response = connection.getresponse()
                        self.assertEqual(response.status, 302)
                        self.assertEqual(response.getheader("Location"), outside)
                        self.assertEqual(response.read(), b"")
                    finally:
                        connection.close()
                    # A API de descoberta permanece valida; so um asset
                    # redireciona. A suite Android deve BLOQUEAR o Location.
                    with urlopen(
                        f"http://127.0.0.1:{server.server_port}/releases/latest"
                    ) as response:
                        self.assertEqual(json.load(response), release)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)


    def test_circular_redirects_return_same_location_without_serving_assets(self):
        release, manifest = ota.build_fixture(self.metadata)
        tag = release["tag_name"]
        for mode, asset in (
            ("manifest-redirect-loop", "update.json"),
            ("apk-redirect-loop", "atrio-catolico.apk"),
        ):
            with self.subTest(mode=mode):
                self.assertEqual(
                    ota.build_fixture(self.metadata, fixture_mode=mode),
                    ota.build_fixture(self.metadata, fixture_mode="valid"),
                )
                handler = ota.make_handler(
                    self.apk, release, manifest, fixture_mode=mode
                )
                server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    path = f"/releases/download/{tag}/{asset}"
                    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                    try:
                        # O cliente Android deve impor seu proprio limite
                        # de redirects; nao seguimos nenhum destino aqui.
                        for _ in range(2):
                            connection.request("GET", path)
                            response = connection.getresponse()
                            self.assertEqual(response.status, 302)
                            self.assertEqual(response.getheader("Location"), path)
                            self.assertEqual(response.read(), b"")
                    finally:
                        connection.close()
                    with urlopen(
                        f"http://127.0.0.1:{server.server_port}/releases/latest"
                    ) as response:
                        self.assertEqual(json.load(response), release)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)

    def test_slow_stream_allows_the_client_to_disconnect(self):
        # Este fixture faz a leitura parcial de um APK lento, sem utilizar
        # um aplicativo real nem esperar o arquivo inteiro.
        self.apk.write_bytes(b"X" * 200_000)
        self.metadata["apkSizeBytes"] = self.apk.stat().st_size
        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(self.apk, release, manifest, fixture_mode="slow-apk")
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = (
            f"http://127.0.0.1:{server.server_port}/releases/download/"
            "v0.19.8/atrio-catolico.apk"
        )
        try:
            with urlopen(url) as response:
                self.assertEqual(int(response.headers["Content-Length"]), 200_000)
                self.assertEqual(response.read(1024), b"X" * 1024)
                # Equivale ao cliente fechar o socket durante o download.
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


    def test_concurrent_api_failures_are_exactly_once_and_recover(self):
        # A rota /releases/latest usa lock no servidor REAL de QA.
        # Cinco clientes simultaneos devem observar so um erro transitorio.
        from concurrent.futures import ThreadPoolExecutor

        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(
            self.apk, release, manifest, fixture_mode="api-unavailable-once"
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        latest = base + "/releases/latest"

        def fetch_latest(_):
            try:
                with urlopen(latest, timeout=5) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, None

        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                results = list(pool.map(fetch_latest, range(5)))
            self.assertEqual([status for status, _ in results].count(503), 1)
            self.assertEqual([status for status, _ in results].count(200), 4)
            for status, payload in results:
                if status == 200:
                    self.assertEqual(payload, release)
            for _ in range(2):
                with urlopen(latest, timeout=5) as response:
                    self.assertEqual(json.load(response), release)
            with urlopen(
                base + "/releases/download/v0.19.8/update.json", timeout=5
            ) as response:
                self.assertEqual(json.load(response), manifest)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_concurrent_download_retries_preserve_exact_apk_bytes(self):
        # Sob 5 downloads concorrentes, somente UM fluxo e truncado.
        # Todos os demais recebem bytes identicos e a retry recupera.
        from concurrent.futures import ThreadPoolExecutor
        from hashlib import sha256

        data = b"CONCORRENCIA OTA ISOLADA " * 4096
        self.apk.write_bytes(data)
        self.metadata["apkSizeBytes"] = len(data)
        self.metadata["apkSha256"] = sha256(data).hexdigest()
        release, manifest = ota.build_fixture(self.metadata)
        handler = ota.make_handler(
            self.apk, release, manifest, fixture_mode="truncated-once"
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        url = base + "/releases/download/v0.19.8/atrio-catolico.apk"

        def download(_):
            try:
                with urlopen(url, timeout=5) as response:
                    self.assertEqual(int(response.headers["Content-Length"]), len(data))
                    return "complete", response.read()
            except IncompleteRead as error:
                return "truncated", error.partial

        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                attempts = list(pool.map(download, range(5)))
            self.assertEqual(
                sum(kind == "truncated" for kind, _ in attempts), 1
            )
            self.assertEqual(
                sum(kind == "complete" for kind, _ in attempts), 4
            )
            for kind, body in attempts:
                if kind == "complete":
                    self.assertEqual(sha256(body).hexdigest(), manifest["apkSha256"])
                    self.assertEqual(body, data)
                else:
                    self.assertGreater(len(body), 0)
                    self.assertLess(len(body), len(data))
            with urlopen(url, timeout=5) as response:
                self.assertEqual(response.read(), data)
            with urlopen(
                base + "/releases/download/v0.19.8/update.json", timeout=5
            ) as response:
                self.assertEqual(json.load(response), manifest)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

if __name__ == "__main__":
    unittest.main()
