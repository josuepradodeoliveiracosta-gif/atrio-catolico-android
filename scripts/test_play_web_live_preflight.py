#!/usr/bin/env python3
"""Offline tests: never contact DNS, HTTPS, Firebase or the Play Console."""
import io
import socket
import unittest
from play_web_live_preflight import (
    PublicResourceError, public_url, verify_public_dns,
    fetch_public_html, inspect_live_resources,
    inspect_firebase_runtime, preflight,
)

P = "https://app.atrio.org/politica"
D = "https://app.atrio.org/excluir"
EMAIL = "privacidade@atrio.org"
POLICY = "<!doctype html><html><body>Átrio Católico — Política de Privacidade</body></html>"
DELETE = ('<!doctype html><html><body><h1>Átrio Católico — Exclusão de conta</h1>'
          '<a href="mailto:privacidade@atrio.org?subject=Exclus%C3%A3o">Pedir</a>'
          '<a href="https://app.atrio.org/politica">Política de Privacidade</a>'
          '</body></html>')
FIREBASE = ('<!doctype html><html><body><h1>Átrio Católico — Exclusão de conta</h1>'
            '<form id="login-form"></form></body></html>')
CONFIG = 'window.ATRIO_PORTAL_STATUS = Object.freeze({"intakeEnabled":true,"actualDeletionEnabled":true});'
APP = "const LIVE_INTAKE_REVIEWED_AND_APPROVED=true;"


def resolver(host, port, **kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]


class FakeResponse:
    def __init__(self, content, *, status=200, mime="text/html", declared=None):
        self.raw = io.BytesIO(content.encode("utf-8") if isinstance(content, str) else content)
        self.status = status
        self.headers = {"Content-Type": mime}
        if declared is not None:
            self.headers["Content-Length"] = declared

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, n=-1):
        return self.raw.read(n)


def fetcher_for(routes):
    calls = []
    def get(url):
        calls.append(url)
        return routes[url]
    return get, calls


class PublicWebSmokeTests(unittest.TestCase):
    def test_valid_public_manual_site_has_no_false_release_approval(self):
        fetcher, calls = fetcher_for({P: FakeResponse(POLICY), D: FakeResponse(DELETE)})
        result = preflight(P, D, "manual-support", EMAIL, fetcher, resolver)
        self.assertEqual(calls, [P, D])
        self.assertFalse(result["actualDeletionVerified"])
        self.assertFalse(result["signatureApproved"])
        self.assertFalse(result["emailReceivedVerified"])

    def test_valid_firebase_site_requires_published_runtime_flags(self):
        origin = "https://app.atrio.org"
        sites = {
            P: FakeResponse(POLICY),
            D: FakeResponse(FIREBASE),
            origin + "/config.js": FakeResponse(CONFIG, mime="application/javascript"),
            origin + "/app.js": FakeResponse(APP, mime="application/javascript"),
        }
        fetcher, calls = fetcher_for(sites)
        result = preflight(P, D, "firebase", "", fetcher, resolver)
        self.assertEqual(len(calls), 4)
        self.assertFalse(result["actualDeletionVerified"])
        for bad in (
            CONFIG.replace('"intakeEnabled":true', '"intakeEnabled":false'),
            CONFIG.replace('"actualDeletionEnabled":true', '"actualDeletionEnabled":false'),
        ):
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(PublicResourceError, "runtime_disabled"):
                    inspect_firebase_runtime(bad, APP)
        with self.assertRaisesRegex(PublicResourceError, "runtime_disabled"):
            inspect_firebase_runtime(CONFIG, APP.replace("=true;", "=false;"))

    def test_html_evidence_must_show_brand_and_functional_request_link(self):
        for broken in (
            DELETE.replace("Átrio Católico", "Outro app"),
            DELETE.replace("mailto:privacidade@atrio.org", "mailto:outro@atrio.org"),
            DELETE.replace('href="https://app.atrio.org/politica"', 'href="https://wrong.org"'),
            DELETE.replace("Exclusão", "Suspensão"),
        ):
            with self.subTest(broken=broken):
                with self.assertRaises(PublicResourceError):
                    inspect_live_resources(POLICY, broken, "manual-support", EMAIL, P)
        with self.assertRaisesRegex(PublicResourceError, "privacy_page_not_identified"):
            inspect_live_resources("<html>Em construção</html>", DELETE,
                                   "manual-support", EMAIL, P)

    def test_urls_must_be_static_https_public_hosts(self):
        for u in (
            "", "http://app.atrio.org/politica", "https://localhost/x",
            "https://127.0.0.1/x", "https://app.atrio.test/x",
            "https://example.com/x", "https://private.invalid/x",
            "https://atrio-catolico-privacidade-qa.pages.dev/excluir-conta",
            "https://foo:pass@app.atrio.org/x", "https://app.atrio.org/x?a=secret",
            "https://app.atrio.org/x#part", "https://app.atrio.org:444/x",
        ):
            with self.subTest(u=u):
                with self.assertRaises(PublicResourceError):
                    public_url(u)

    def test_private_resolved_address_and_missing_dns_fail_closed(self):
        for addr in ("127.0.0.1", "10.1.1.1", "192.168.1.1", "169.254.1.1",
                     "fd00::1"):
            def private(host, port, **kwargs):
                return [(socket.AF_INET, 1, 0, "", (addr, 443))]
            with self.subTest(addr=addr):
                with self.assertRaisesRegex(PublicResourceError, "nonpublic_dns_address"):
                    verify_public_dns("app.atrio.org", private)
        with self.assertRaisesRegex(PublicResourceError, "nonpublic_dns_address"):
            verify_public_dns("app.atrio.org", lambda *a, **k: [])
        with self.assertRaisesRegex(PublicResourceError, "unverifiable_dns"):
            verify_public_dns("app.atrio.org", lambda *a, **k: (_ for _ in ()).throw(OSError()))

    def test_mime_length_utf8_or_http_error_stops_smoke(self):
        failures = [
            (FakeResponse("x" * 256001), "too_large"),
            (FakeResponse("{}", declared="256001"), "invalid_content_length"),
            (FakeResponse("{}", declared="NaN"), "invalid_content_length"),
            (FakeResponse("{}", mime="application/json"), "wrong_content_type"),
            (FakeResponse(b"\xff\xfe"), "invalid_utf8"),
            (FakeResponse("{}", status=503), "http_not_200"),
        ]
        for resp, expected in failures:
            with self.subTest(expected=expected):
                with self.assertRaisesRegex(PublicResourceError, expected):
                    fetch_public_html(P, lambda url: resp, resolver)

    def test_unknown_mode_is_rejected_before_communication(self):
        fetcher, calls = fetcher_for({})
        with self.assertRaisesRegex(PublicResourceError, "deletion_mode_not_approved"):
            preflight(P, D, "auto-delete", "", fetcher, resolver)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
