#!/usr/bin/env python3
"""Private official-package OTA pilot server. No signing, deployment or CDN.

Binds 127.0.0.1:8765 ONLY. Only serves an existing APK verified against an
independently supplied SHA-256 and the historical official signing certificate.
Not intended to serve public APK downloads or distribute a GitHub Release.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

from scripts.ota_apk_preflight import (
    PACKAGE, PreflightError, digest, file_sha256, inspect_apk
)
from scripts.ota_release_cert import require_official_certificate

ORIGIN = "http://127.0.0.1:8765"
MAX_APK_BYTES = 262_144_000
MINIMUM_BASE_VERSION_CODE = 36  # 0.20.0/35 did not have OTA.


def prepare_offer(apk, *, sdk, expected_sha256, base_code):
    """Never trusts metadata supplied by HTTP client or manifest."""
    apk = Path(apk).resolve(strict=True)
    if not apk.is_file() or not (0 < apk.stat().st_size <= MAX_APK_BYTES):
        raise PreflightError("APK ausente ou com tamanho fora do contrato")
    if base_code < MINIMUM_BASE_VERSION_CODE:
        raise PreflightError("Base precisa conter OTA: code36 ou posterior")
    expected = digest(expected_sha256)
    if file_sha256(apk) != expected:
        raise PreflightError("APK candidato difere do SHA-256 independente")
    details = inspect_apk(apk, Path(sdk))
    require_official_certificate(details["certificate_sha256"])
    if details["package"] != PACKAGE:
        raise PreflightError("PackageName nao pertence ao Atrio")
    if details["versionCode"] <= base_code:
        raise PreflightError("Candidato nao supera o versionCode da base")
    sdk_dir = Path(sdk)
    analyzer = sdk_dir / "cmdline-tools/latest/bin/apkanalyzer"
    try:
        minimum = subprocess.check_output(
            [str(analyzer), "manifest", "min-sdk", str(apk)],
            text=True, stderr=subprocess.DEVNULL, timeout=30
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        raise PreflightError("Nao foi possivel validar minSdk") from None
    if not re.fullmatch(r"[0-9]+", minimum) or int(minimum) < 26:
        raise PreflightError("minSdk invalido no APK candidato")
    if file_sha256(apk) != expected:
        raise PreflightError("APK mudou durante o preflight")
    version = details["versionName"]
    tag = "v" + version
    page = ORIGIN + "/releases/tag/" + tag
    apk_url = ORIGIN + "/releases/download/" + tag + "/atrio-catolico.apk"
    manifest_url = ORIGIN + "/releases/download/" + tag + "/update.json"
    manifest = {
        "schemaVersion": 1,
        "channel": "stable",  # Contract of the real OTA policy, on local origin.
        "applicationId": PACKAGE,
        "versionName": version,
        "versionCode": details["versionCode"],
        "mandatory": False,
        "minimumAndroidSdk": int(minimum),
        "apkAsset": "atrio-catolico.apk",
        "apkSizeBytes": apk.stat().st_size,
        "apkSha256": expected,
        "certificateSha256": details["certificate_sha256"],
        "downloadUrl": apk_url,
        "releasePageUrl": page,
        "releaseNotes": "Homologação OTA local do Átrio Católico. Não distribuir.",
    }
    release = {
        "tag_name": tag,
        "html_url": page,
        "draft": False,  # Local emulation only; never published to GitHub.
        "prerelease": False,
        "assets": [
            {"name": "update.json", "browser_download_url": manifest_url},
            {"name": "atrio-catolico.apk", "browser_download_url": apk_url},
        ],
    }
    return release, manifest


def make_handler(apk, release, manifest):
    """Only three fixed paths. Reject path traversal and changed source APK."""
    apk = Path(apk)
    tag = release["tag_name"]
    manifest_path = "/releases/download/" + tag + "/update.json"
    apk_path = "/releases/download/" + tag + "/atrio-catolico.apk"
    manifest_bytes = json.dumps(
        manifest, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    release_bytes = json.dumps(
        release, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            request = urlsplit(self.path)
            if request.query or request.fragment:
                self.send_error(404)
                return
            if request.path == "/releases/latest":
                body, content_type = release_bytes, "application/json"
            elif request.path == manifest_path:
                body, content_type = manifest_bytes, "application/json"
            elif request.path == apk_path:
                if (not apk.is_file() or
                        apk.stat().st_size != manifest["apkSizeBytes"] or
                        file_sha256(apk) != manifest["apkSha256"]):
                    self.send_error(409, "APK diferente do manifesto homologado")
                    return
                try:
                    with apk.open("rb") as source:
                        self.send_response(200)
                        self.send_header("Content-Type", "application/vnd.android.package-archive")
                        self.send_header("Content-Length", str(manifest["apkSizeBytes"]))
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("X-Content-Type-Options", "nosniff")
                        self.end_headers()
                        while chunk := source.read(131072):
                            self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            print("OTA PILOTO LOCAL: " + (format % args), file=sys.stderr)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--android-sdk", required=True, type=Path)
    parser.add_argument("--candidate-sha256", required=True)
    parser.add_argument("--base-code", required=True, type=int)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    try:
        release, manifest = prepare_offer(
            args.apk, sdk=args.android_sdk,
            expected_sha256=args.candidate_sha256, base_code=args.base_code
        )
        print(json.dumps({
            "mode": "PRIVATE_LOCAL_ONLY", "bind": "127.0.0.1:8765",
            "candidate": manifest["versionName"], "code": manifest["versionCode"],
            "certificate": manifest["certificateSha256"],
            "hash": manifest["apkSha256"],
            "not_public": True,
        }, ensure_ascii=False), flush=True)
        if args.verify_only:
            return 0
        with ThreadingHTTPServer(
            ("127.0.0.1", 8765), make_handler(args.apk, release, manifest)
        ) as server:
            server.serve_forever()
        return 0
    except (PreflightError, OSError, ValueError) as exc:
        print("PILOTO OTA BLOQUEADO: " + str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
