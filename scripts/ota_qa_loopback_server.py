#!/usr/bin/env python3
"""Servidor OTA de QA para um APK DEBUG em loopback (sem GitHub, Firebase ou segredo).

Usar no Termux sobre o proprio Android ou em um runner com "adb reverse".
Expõe somente 127.0.0.1:8765, nunca 0.0.0.0.
Confere a identidade do APK com apkanalyzer + apksigner antes de oferecer
o manifesto. Apenas os caminhos fixos do fixture são servidos.
"""
import argparse
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

ORIGIN = "http://127.0.0.1:8765"
PACKAGE = "br.com.atriocatolico.otalab"
MAX_APK_BYTES = 262_144_000


def inspect_apk(apk: Path, sdk: Path) -> dict:
    if not apk.is_file() or not 0 < apk.stat().st_size <= MAX_APK_BYTES:
        raise ValueError("APK ausente ou tamanho invalido")
    analyzer = sdk / "cmdline-tools/latest/bin/apkanalyzer"
    signer = sdk / "build-tools/35.0.0/apksigner"
    if not analyzer.is_file() or not signer.is_file():
        raise ValueError("Android SDK sem apkanalyzer e/ou apksigner")
    def analyze(*args: str) -> str:
        return subprocess.check_output(
            [str(analyzer), "manifest", *args, str(apk)], text=True,
            stderr=subprocess.DEVNULL, timeout=30).strip()
    pkg = analyze("application-id")
    code_text = analyze("version-code")
    name = analyze("version-name")
    min_sdk_text = analyze("min-sdk")
    if pkg != PACKAGE or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", name):
        raise ValueError("Identidade ou versao do APK inesperada")
    code, min_sdk = int(code_text), int(min_sdk_text)
    if code < 1 or min_sdk < 26:
        raise ValueError("VersionCode ou SDK fora do contrato")
    signature = subprocess.check_output(
        [str(signer), "verify", "--print-certs", str(apk)],
        text=True, stderr=subprocess.DEVNULL, timeout=30)
    certs = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})",
                       signature, re.IGNORECASE)
    if len(certs) != 1:
        raise ValueError("APK deve ter exatamente uma identidade assinante")
    h = hashlib.sha256()
    with apk.open("rb") as source:
        for chunk in iter(lambda: source.read(131072), b""):
            h.update(chunk)
    return {
        "versionName": name,
        "versionCode": code,
        "minimumAndroidSdk": min_sdk,
        "apkSizeBytes": apk.stat().st_size,
        "apkSha256": h.hexdigest(),
        "certificateSha256": certs[0].lower(),
    }


def build_fixture(info: dict, *, fixture_mode: str = "valid") -> tuple[dict, dict]:
    """The release shape matches the GitHub API, but is never published there."""
    name = info["versionName"]
    tag = "v" + name
    page = f"{ORIGIN}/releases/tag/{tag}"
    base = f"{ORIGIN}/releases/download/{tag}"
    apk_url = f"{base}/atrio-catolico.apk"
    json_url = f"{base}/update.json"
    manifest = {
        "schemaVersion": 1,
        "channel": "stable",
        "applicationId": PACKAGE,
        "versionName": name,
        "versionCode": info["versionCode"],
        "mandatory": False,
        "minimumAndroidSdk": info["minimumAndroidSdk"],
        "apkAsset": "atrio-catolico.apk",
        "apkSizeBytes": info["apkSizeBytes"],
        "apkSha256": info["apkSha256"],
        "certificateSha256": info["certificateSha256"],
        "downloadUrl": apk_url,
        "releasePageUrl": page,
        "releaseNotes": "Teste isolado de atualização OTA entre dois APKs Debug.",
    }
    if fixture_mode == "bad-hash":
        manifest["apkSha256"] = "0" * 64
    elif fixture_mode == "bad-cert":
        manifest["certificateSha256"] = "0" * 64
    elif fixture_mode == "downgrade":
        manifest["versionCode"] = 1
    elif fixture_mode not in ("valid", "truncated-apk", "truncated-once", "slow-apk"):
        raise ValueError("Modo de fixture nao autorizado")
    release = {
        "tag_name": tag,
        "html_url": page,
        "draft": False,
        "prerelease": False,
        "assets": [
            {"name": "update.json", "browser_download_url": json_url},
            {"name": "atrio-catolico.apk", "browser_download_url": apk_url},
        ],
    }
    return release, manifest


def make_handler(apk: Path, release: dict, manifest: dict, fixture_mode: str = "valid"):
    tag = release["tag_name"]
    asset_prefix = "/releases/download/" + tag + "/"
    urls = {
        "/releases/latest": json.dumps(release, ensure_ascii=False).encode(),
        asset_prefix + "update.json": json.dumps(manifest, ensure_ascii=False).encode(),
    }
    # Estado limitado ao servidor local e a este fixture: primeiro GET de APK
    # incompleto, segundo GET completo. A troca e atomica entre threads.
    request_lock = Lock()
    apk_requests = 0

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlsplit(self.path)
            if url.query or url.fragment:
                self.send_error(404)
                return
            if url.path in urls:
                body = urls[url.path]
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            elif url.path == asset_prefix + "atrio-catolico.apk":
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.android.package-archive")
                self.send_header("Content-Length", str(apk.stat().st_size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                nonlocal apk_requests
                with request_lock:
                    apk_requests += 1
                    attempt = apk_requests
                with apk.open("rb") as source:
                    if fixture_mode == "truncated-once" and attempt == 1:
                        # Simula rede interrompida na primeira tentativa.
                        # A segunda entrega o APK completo e valido.
                        self.wfile.write(source.read(min(4096, max(1, apk.stat().st_size // 2))))
                        self.wfile.flush()
                        self.close_connection = True
                    elif fixture_mode == "truncated-apk":
                        # Declara o tamanho completo, mas corta a conexão no início.
                        # O cliente deve rejeitar o arquivo e apagar o .part.
                        self.wfile.write(source.read(min(4096, max(1, apk.stat().st_size // 2))))
                        self.wfile.flush()
                        self.close_connection = True
                    elif fixture_mode == "slow-apk":
                        # Garante uma janela de cancelamento pela interface real.
                        # O certificado, SHA-256 e metadados continuam validos.
                        try:
                            while chunk := source.read(16384):
                                self.wfile.write(chunk)
                                self.wfile.flush()
                                time.sleep(0.15)
                        except (BrokenPipeError, ConnectionResetError):
                            # Ao cancelar, o cliente encerra o socket de proposito.
                            pass
                    else:
                        while chunk := source.read(131072):
                            self.wfile.write(chunk)
            else:
                self.send_error(404)

        def log_message(self, fmt, *args):
            print("OTA QA LOCAL:", fmt % args, file=sys.stderr)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True,
                        help="APK QA destino assinado; nunca um APK oficial")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--sdk", type=Path,
                       help="Diretorio Android SDK; extrai metadados da assinatura")
    group.add_argument("--manifest", type=Path,
                       help="Manifesto gerado em CI; confere SHA-256 local do APK")
    parser.add_argument("--write-manifest", type=Path,
                        help="Gravar update.json para distribuir junto aos dois APKs QA")
    parser.add_argument("--verify-only", action="store_true",
                        help="Validar e/ou gerar manifesto sem ligar o servidor")
    parser.add_argument("--mode", choices=["valid", "bad-hash", "bad-cert", "downgrade", "truncated-apk", "truncated-once", "slow-apk"],
                        default="valid")
    args = parser.parse_args()
    apk = args.apk.resolve(strict=True)
    if args.sdk is not None:
        info = inspect_apk(apk, args.sdk)
    else:
        stored = json.loads(args.manifest.read_text(encoding="utf-8"))
        fields = ("versionName", "versionCode", "minimumAndroidSdk",
                  "apkSizeBytes", "apkSha256", "certificateSha256")
        info = {field: stored[field] for field in fields}
        trusted_release, trusted_manifest = build_fixture(info)
        if stored != trusted_manifest:
            raise ValueError("Manifesto local foi modificado ou possui contrato inesperado")
        if apk.stat().st_size != info["apkSizeBytes"]:
            raise ValueError("APK difere do tamanho do manifesto CI")
        h = hashlib.sha256()
        with apk.open("rb") as source:
            for chunk in iter(lambda: source.read(131072), b""):
                h.update(chunk)
        if h.hexdigest() != info["apkSha256"]:
            raise ValueError("APK difere do SHA-256 do manifesto CI")
    release, manifest = build_fixture(info, fixture_mode=args.mode)
    if args.write_manifest:
        if args.sdk is None:
            raise ValueError("Gravar manifesto exige SDK para validar APK assinado")
        args.write_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                      encoding="utf-8")
    print(json.dumps({"channel": "LOCAL_QA_ONLY", "version": info["versionName"],
                      "code": info["versionCode"], "mode": args.mode,
                      "host": "127.0.0.1", "port": 8765}), flush=True)
    if args.verify_only:
        return
    httpd = ThreadingHTTPServer(("127.0.0.1", 8765),
                                make_handler(apk, release, manifest, fixture_mode=args.mode))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
