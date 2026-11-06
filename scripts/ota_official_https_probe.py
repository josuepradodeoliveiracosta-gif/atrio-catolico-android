#!/usr/bin/env python3
"""Read-only HTTPS preflight for Átrio's official GitHub Releases channel.

A 404 from /releases/latest AND an empty public /releases list are the
expected pre-publication state. The probe never uploads/downloads APK files,
signs, publishes, uses account tokens, or changes approval gates.

Offline contract validation is available through validate_release_contract()
for use by the unit tests. It does not claim to test real GitHub CDN delivery.
"""
import argparse
import json
import re
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from scripts.ota_apk_preflight import PreflightError
from scripts.ota_release import REPO, PACKAGE, APK_ASSET, MANIFEST_ASSET
from scripts.ota_release_cert import PINNED_OFFICIAL_CERT_SHA256

API_ORIGIN = "https://api.github.com"
API_LATEST = f"{API_ORIGIN}/repos/{REPO}/releases/latest"
API_LIST = f"{API_ORIGIN}/repos/{REPO}/releases?per_page=5"
GITHUB_ORIGIN = f"https://github.com/{REPO}"
ALLOWED_ROUTES = frozenset((API_LATEST, API_LIST))
MAX_JSON_BYTES = 262_144
MAX_APK_BYTES = 262_144_000
HEX_SHA256 = re.compile(r"[0-9a-fA-F]{64}\Z")
VERSION_TAG = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+\Z")


class NoRedirects(HTTPRedirectHandler):
    """Never follow redirects to another origin for API metadata."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(test, message):
    if not test:
        raise PreflightError(message)


def fetch_public_json(url):
    """Exact-host HTTPS GET, system CA verification, no redirects or credentials."""
    require(url in ALLOWED_ROUTES, "Endereco HTTPS fora do GitHub API oficial")
    request = Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "Atrio-Catolico-OTA-ReadOnly-Homologacao",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    opener = build_opener(
        HTTPSHandler(context=ssl.create_default_context()),
        NoRedirects(),
    )
    try:
        with opener.open(request, timeout=12) as response:
            require(response.status == 200, "Status HTTPS inesperado")
            body = response.read(MAX_JSON_BYTES + 1)
    except HTTPError as exc:
        if url == API_LATEST and exc.code == 404:
            return 404, None
        raise PreflightError(
            f"Resposta HTTP inesperada do GitHub: {exc.code}"
        ) from None
    except (URLError, TimeoutError, OSError) as exc:
        raise PreflightError("Nao foi possivel confirmar o GitHub HTTPS") from exc
    require(len(body) <= MAX_JSON_BYTES, "Resposta HTTPS excede limite")
    try:
        return 200, json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise PreflightError("JSON HTTPS do GitHub invalido") from None


def verify_no_public_release(reader=fetch_public_json):
    """Fail closed on any visible release or indeterminate network response."""
    status, latest = reader(API_LATEST)
    require(status == 404 and latest is None,
            "Ultima Release publica presente ou consulta inconclusiva")
    list_status, releases = reader(API_LIST)
    require(list_status == 200 and isinstance(releases, list),
            "Lista de Releases nao confirmada pelo GitHub")
    require(len(releases) == 0,
            "Existe Release publica; preflight de canal vazio interrompido")
    return {
        "checked_origin": API_ORIGIN,
        "latest": "HTTP 404 - sem Release publica",
        "public_releases": 0,
        "read_only": True,
        "apk_downloaded": False,
        "github_cdn_tested": False,
        "android_installer_tested": False,
        "ota_release_approved": False,
        "ota_e2e_gate_changed": False,
    }


def validate_release_contract(release, manifest, *, installed_code):
    """Offline future-release contract: exact URLs, pinned signer and upgrade.

    It does NOT perform an HTTPS GET of a release asset or prove the
    installer/CDN works in a physical device.
    """
    require(isinstance(release, dict) and isinstance(manifest, dict),
            "Metadados devem ser objetos JSON")
    require(type(installed_code) is int and installed_code > 0,
            "Codigo instalado invalido")
    tag = release.get("tag_name")
    require(isinstance(tag, str) and VERSION_TAG.fullmatch(tag),
            "Tag da Release fora do padrao")
    require(release.get("draft") is False and release.get("prerelease") is False,
            "Draft ou prerelease nao pode atualizar usuarios")
    page = f"{GITHUB_ORIGIN}/releases/tag/{tag}"
    require(release.get("html_url") == page,
            "Pagina da Release diverge do repositorio oficial")
    assets = release.get("assets")
    require(isinstance(assets, list) and len(assets) == 3,
            "Release deve possuir somente os tres arquivos oficiais")
    asset_urls = {}
    for asset in assets:
        require(isinstance(asset, dict), "Asset invalido")
        name, url = asset.get("name"), asset.get("browser_download_url")
        require(name in (APK_ASSET, MANIFEST_ASSET, "SHA256SUMS.txt") and
                name not in asset_urls and isinstance(url, str),
                "Asset extra, duplicado ou sem URL")
        expected = f"{GITHUB_ORIGIN}/releases/download/{tag}/{name}"
        require(url == expected, "URL de asset nao corresponde ao GitHub oficial")
        asset_urls[name] = url
    require(set(asset_urls) == {APK_ASSET, MANIFEST_ASSET, "SHA256SUMS.txt"},
            "Arquivos oficiais incompletos")
    name = tag[1:]
    code = manifest.get("versionCode")
    require(type(code) is int and code > installed_code,
            "Nao disponibilizar versao igual ou downgrade")
    require(manifest.get("versionName") == name,
            "Nome do manifesto e tag divergem")
    require(manifest.get("schemaVersion") == 1 and
            manifest.get("channel") == "stable" and
            manifest.get("applicationId") == PACKAGE,
            "Manifesto fora do contrato do cliente oficial")
    require(manifest.get("mandatory") is False and
            manifest.get("apkAsset") == APK_ASSET,
            "Atualizacao obrigatoria ou APK divergente")
    require(type(manifest.get("minimumAndroidSdk")) is int and
            manifest["minimumAndroidSdk"] >= 26,
            "SDK minimo invalido")
    size = manifest.get("apkSizeBytes")
    require(type(size) is int and 0 < size <= MAX_APK_BYTES,
            "Tamanho do APK fora dos limites")
    digest = manifest.get("apkSha256")
    require(isinstance(digest, str) and HEX_SHA256.fullmatch(digest),
            "SHA-256 do APK ausente ou invalido")
    require(manifest.get("certificateSha256") == PINNED_OFFICIAL_CERT_SHA256,
            "Certificado nao corresponde ao assinante oficial historico")
    require(manifest.get("downloadUrl") == asset_urls[APK_ASSET] and
            manifest.get("releasePageUrl") == page,
            "Links do manifesto divergentes")
    notes = manifest.get("releaseNotes")
    require(isinstance(notes, str) and 10 <= len(notes) <= 3000,
            "Notas de versao fora dos limites")
    return {
        "contract": "official_https_metadata_fixture_valid",
        "version": name, "code": code,
        "download_tested": False,
        "signature_of_apk_bytes_tested": False,
        "installation_tested": False,
        "release_published": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-empty", action="store_true",
                        help="Consultas publicas TLS/HTTPS somente leitura; esperar 404 e []")
    args = parser.parse_args()
    if not args.check_empty:
        parser.error("Escolha --check-empty; nao existem comandos de publicacao")
    try:
        record = verify_no_public_release()
    except (PreflightError, OSError, ValueError) as exc:
        print("PRE-FLIGHT HTTPS INCONCLUSIVO/BLOQUEADO: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
