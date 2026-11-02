#!/usr/bin/env python3
"""Verify the PUBLIC HTTPS deletion and privacy pages before Play signing.

This is a read-only smoke test, NOT proof of processing real deletion or
legal compliance. No credentials, cookies, form submission, data writes,
Firebase access or Play upload. Runs only in the manual signature workflow.
"""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
import ipaddress
import re
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener
import ssl

MAX_BYTES = 256_000
USER_AGENT = "Atrio-Play-Public-Resource-Preflight/1.0"


class PublicResourceError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def public_url(value: str) -> tuple[str, str]:
    if not isinstance(value, str) or len(value) > 2048 or not value:
        raise PublicResourceError("public_https_url_required")
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError as e:
        raise PublicResourceError("invalid_public_url") from e
    if (parsed.scheme != "https" or not host or parsed.username or
        parsed.password or parsed.query or parsed.fragment or
        port not in (None, 443) or not re.fullmatch(
            r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}",
            host
        ) or host.endswith((".example.com", ".example.net", ".example.org",
                           ".test", ".invalid", ".local", ".localhost")) or
        host in ("example.com", "example.net", "example.org")):
        raise PublicResourceError("invalid_public_https_url")
    return value, host


def verify_public_dns(host: str, resolver=socket.getaddrinfo) -> None:
    try:
        entries = resolver(host, 443, type=socket.SOCK_STREAM)
        addresses = {str(item[4][0]) for item in entries}
        if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
            raise PublicResourceError("nonpublic_dns_address")
    except (OSError, ValueError, IndexError) as e:
        raise PublicResourceError("unverifiable_dns") from e


def fetch_public_html(url: str, fetcher=None, resolver=socket.getaddrinfo) -> str:
    """Reject redirects, private DNS, oversize, non-HTML, malformed UTF-8."""
    approved, host = public_url(url)
    verify_public_dns(host, resolver)
    if fetcher is None:
        def fetcher(address):
            req = Request(address, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/javascript,text/javascript",
                "Cache-Control": "no-cache",
            }, method="GET")
            return build_opener(
                HTTPSHandler(context=ssl.create_default_context()),
                NoRedirect()
            ).open(req, timeout=12)
    try:
        with fetcher(approved) as response:
            if response.status != 200:
                raise PublicResourceError("public_page_http_not_200")
            declared = response.headers.get("Content-Length")
            if declared is not None and (
                not declared.isdecimal() or int(declared) > MAX_BYTES
            ):
                raise PublicResourceError("public_page_invalid_content_length")
            kind = response.headers.get("Content-Type", "")
            if not (kind.lower().startswith("text/html") or
                    kind.lower().startswith("application/javascript") or
                    kind.lower().startswith("text/javascript")):
                raise PublicResourceError("public_page_wrong_content_type")
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise PublicResourceError("public_page_too_large")
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        raise PublicResourceError("public_page_unreachable") from e
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as e:
        raise PublicResourceError("public_page_invalid_utf8") from e


class PageInfo(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.words = []
        self.links = []
        self.form_ids = []

    def handle_data(self, data):
        self.words.append(data)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.links.append(attrs.get("href", ""))
        if tag == "form":
            self.form_ids.append(attrs.get("id", ""))


def inspect_live_resources(privacy_html: str, deletion_html: str,
                           deletion_mode: str, expected_email: str = "",
                           privacy_url: str = "") -> None:
    privacy, deletion = PageInfo(), PageInfo()
    privacy.feed(privacy_html)
    deletion.feed(deletion_html)
    policy_text = " ".join(privacy.words).casefold()
    delete_text = " ".join(deletion.words).casefold()
    if "átrio católico" not in policy_text or "privacidade" not in policy_text:
        raise PublicResourceError("privacy_page_not_identified")
    if ("átrio católico" not in delete_text or "exclusão" not in delete_text or
        "conta" not in delete_text):
        raise PublicResourceError("deletion_page_not_identified")
    if deletion_mode == "manual-support":
        if (not expected_email or
            not any(link.startswith("mailto:" + expected_email + "?subject=")
                    for link in deletion.links)):
            raise PublicResourceError("working_support_request_link_missing")
        if privacy_url not in deletion.links:
            raise PublicResourceError("privacy_policy_link_missing")
    elif deletion_mode == "firebase":
        if "login-form" not in deletion.form_ids:
            raise PublicResourceError("firebase_portal_form_missing")
    else:
        raise PublicResourceError("deletion_mode_not_approved")


def inspect_firebase_runtime(config_js: str, app_js: str) -> None:
    # A public HTML shell may exist while both operational fences are off.
    if not re.search(r'"intakeEnabled"\s*:\s*true', config_js) or \
       not re.search(r'"actualDeletionEnabled"\s*:\s*true', config_js) or \
       not re.search(r'const LIVE_INTAKE_REVIEWED_AND_APPROVED\s*=\s*true\s*;',
                     app_js):
        raise PublicResourceError("firebase_portal_runtime_disabled")


def preflight(privacy_url: str, deletion_url: str, mode: str,
              support_email: str, fetcher=None, resolver=socket.getaddrinfo):
    _, privacy_host = public_url(privacy_url)
    _, deletion_host = public_url(deletion_url)
    if mode not in ("manual-support", "firebase"):
        raise PublicResourceError("deletion_mode_not_approved")
    privacy = fetch_public_html(privacy_url, fetcher, resolver)
    deletion = fetch_public_html(deletion_url, fetcher, resolver)
    inspect_live_resources(privacy, deletion, mode, support_email, privacy_url)
    if mode == "firebase":
        origin = "https://" + deletion_host
        config = fetch_public_html(origin + "/config.js", fetcher, resolver)
        app = fetch_public_html(origin + "/app.js", fetcher, resolver)
        inspect_firebase_runtime(config, app)
    return {
        "status": "public_web_resources_reachable_and_identified",
        "signatureApproved": False,
        "actualDeletionVerified": False,
        "legalReviewVerified": False,
        "emailReceivedVerified": False,
        "privacyHost": privacy_host,
        "deletionHost": deletion_host,
    }


def main() -> int:
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", required=True)
    args = parser.parse_args()
    try:
        result = preflight(
            os.environ.get("ATRIO_PRIVACY_POLICY_URL", ""),
            os.environ.get("ATRIO_DELETION_PORTAL_URL", ""),
            os.environ.get("ATRIO_PLAY_DELETION_MODE", "firebase"),
            os.environ.get("ATRIO_PLAY_SUPPORT_EMAIL", ""),
        )
        print("OK: paginas publicas HTTPS acessiveis, identificadas e com recurso de pedido.")
        print("NÃO comprova caixa de e-mail, exclusão real, revisão legal nem autoriza Play.")
        print("Host privacy:", result["privacyHost"])
        print("Host deletion:", result["deletionHost"])
        return 0
    except PublicResourceError as exc:
        print("BLOQUEADO: verificação pública de privacidade/exclusão:", exc)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
