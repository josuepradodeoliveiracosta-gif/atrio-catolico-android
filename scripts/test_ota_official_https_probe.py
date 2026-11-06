"""Offline regressions for GitHub Releases HTTPS read-only preflight."""
import copy
from pathlib import Path
import unittest

from scripts.ota_apk_preflight import PreflightError
from scripts.ota_official_https_probe import (
    API_LATEST, API_LIST, GITHUB_ORIGIN, PINNED_OFFICIAL_CERT_SHA256,
    validate_release_contract, verify_no_public_release,
)


def official_fixture():
    tag = "v0.20.3"
    page = f"{GITHUB_ORIGIN}/releases/tag/{tag}"
    def asset(name):
        return {
            "name": name,
            "browser_download_url": f"{GITHUB_ORIGIN}/releases/download/{tag}/{name}",
        }
    release = {
        "tag_name": tag,
        "html_url": page,
        "draft": False,
        "prerelease": False,
        "assets": [asset("atrio-catolico.apk"), asset("update.json"),
                   asset("SHA256SUMS.txt")],
    }
    manifest = {
        "schemaVersion": 1,
        "channel": "stable",
        "applicationId": "br.com.atriocatolico",
        "versionName": "0.20.3",
        "versionCode": 38,
        "mandatory": False,
        "minimumAndroidSdk": 26,
        "apkAsset": "atrio-catolico.apk",
        "apkSizeBytes": 22_000_000,
        "apkSha256": "a" * 64,
        "certificateSha256": PINNED_OFFICIAL_CERT_SHA256,
        "downloadUrl": release["assets"][0]["browser_download_url"],
        "releasePageUrl": page,
        "releaseNotes": "Atualização hipotética apenas para testes de contrato.",
    }
    return release, manifest


class OfficialHttpsReadOnlyTests(unittest.TestCase):
    def test_real_api_empty_state_requires_latest_404_and_list_empty(self):
        seen = []
        def reader(url):
            seen.append(url)
            return (404, None) if url == API_LATEST else (200, [])
        result = verify_no_public_release(reader)
        self.assertEqual(seen, [API_LATEST, API_LIST])
        self.assertEqual(result["public_releases"], 0)
        self.assertFalse(result["github_cdn_tested"])
        self.assertFalse(result["apk_downloaded"])
        self.assertFalse(result["ota_release_approved"])

    def test_unexpected_public_release_or_errors_fail_closed(self):
        cases = [
            ((200, {"tag_name": "v0.20.3"}), (200, [])),
            ((403, None), (200, [])),
            ((302, None), (200, [])),
            ((404, None), (200, [{"tag_name": "v0.20.3"}])),
            ((404, None), (403, None)),
            ((404, None), (200, "not-a-list")),
        ]
        for first, second in cases:
            with self.subTest(first=first, second=second):
                def reader(url):
                    return first if url == API_LATEST else second
                with self.assertRaises(PreflightError):
                    verify_no_public_release(reader)

    def test_positive_fixture_is_not_publication_or_cdn_proof(self):
        release, manifest = official_fixture()
        report = validate_release_contract(release, manifest, installed_code=37)
        self.assertEqual(report["version"], "0.20.3")
        self.assertFalse(report["download_tested"])
        self.assertFalse(report["installation_tested"])
        self.assertFalse(report["release_published"])

    def test_external_asset_and_page_urls_are_rejected(self):
        for change in ("page", "asset", "manifest", "duplicate", "extra"):
            release, manifest = official_fixture()
            if change == "page":
                release["html_url"] = "https://github.com/other/repo/releases/tag/v0.20.3"
            elif change == "asset":
                release["assets"][0]["browser_download_url"] = "http://github.com/app.apk"
            elif change == "manifest":
                manifest["downloadUrl"] = "https://evil.invalid/fake.apk"
            elif change == "duplicate":
                release["assets"][1] = release["assets"][0].copy()
            else:
                release["assets"].append({
                    "name": "extra.zip", "browser_download_url": "https://example.com",
                })
            with self.subTest(change=change):
                with self.assertRaises(PreflightError):
                    validate_release_contract(release, manifest, installed_code=37)

    def test_wrong_signer_wrong_hash_and_wrong_package_are_rejected(self):
        for field, value in (
            ("certificateSha256", "f" * 64),
            ("apkSha256", "not-a-sha256"),
            ("applicationId", "br.com.unknown"),
            ("apkSizeBytes", 0),
            ("minimumAndroidSdk", 23),
            ("schemaVersion", 2),
            ("channel", "beta"),
            ("mandatory", True),
            ("releaseNotes", "short"),
        ):
            release, manifest = official_fixture()
            manifest[field] = value
            with self.subTest(field=field):
                with self.assertRaises(PreflightError):
                    validate_release_contract(release, manifest, installed_code=37)

    def test_downgrade_same_code_draft_and_prerelease_are_rejected(self):
        release, manifest = official_fixture()
        for code in (38, 39, 40):
            with self.subTest(installed_code=code):
                with self.assertRaises(PreflightError):
                    validate_release_contract(release, manifest, installed_code=code)
        for field in ("draft", "prerelease"):
            changed = copy.deepcopy(release)
            changed[field] = True
            with self.subTest(field=field):
                with self.assertRaises(PreflightError):
                    validate_release_contract(changed, manifest, installed_code=37)

    def test_read_only_manual_workflow_preserves_release_gates(self):
        root = Path(__file__).resolve().parents[1]
        wf = (root / ".github/workflows/ota-official-https-readonly.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("  workflow_dispatch:", wf)
        self.assertIn("github.ref == 'refs/heads/main'", wf)
        self.assertIn("github.actor == 'josuepradodeoliveiracosta-gif'", wf)
        self.assertIn("  contents: read", wf)
        self.assertIn("python3 -m scripts.ota_official_https_probe --check-empty", wf)
        for forbidden in (
            "  push:", "  pull_request:", "  schedule:", "  workflow_run:",
            "secrets.", "contents: write", "gh release", "gradle :app:assemble",
            "actions/upload-artifact", "ATRIO_OTA_E2E_TESTED=true",
            "ATRIO_OTA_RELEASE_APPROVED=true", "curl -X POST",
            "gh api --method POST",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, wf)
        for path in (".github/workflows/build-apk.yml",
                     ".github/workflows/ota-publish-release.yml"):
            official = (root / path).read_text(encoding="utf-8")
            self.assertIn("ATRIO_OTA_E2E_TESTED", official)
            self.assertIn("ATRIO_OTA_RELEASE_APPROVED", official)


if __name__ == "__main__":
    unittest.main()
