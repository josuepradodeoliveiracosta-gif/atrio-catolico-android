"""Offline tests for OTA release provenance, manifest and version ordering."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.ota_apk_preflight import PreflightError
from scripts.ota_release import (
    LEGACY_ARTIFACT, LEGACY_COMMIT, LEGACY_RUN_ID, LEGACY_WORKFLOW,
    NORMAL_ARTIFACT, NORMAL_WORKFLOW, REPO,
    assert_newer, assert_newer_than_releases, prepare, validate_source,
)

MAIN_HEAD = "1" * 40
NORMAL_SHA = "2" * 40
CERT = "ab" * 32
GRADLE = ('android {\\n    defaultConfig {\\n'
          '        applicationId = "br.com.atriocatolico"\\n'
          '        versionCode = 35\\n'
          '        versionName = "0.20.0"\\n    }\\n}\\n').replace("\\n", "\n")


def source_run(*, legacy=False):
    return {
        "id": LEGACY_RUN_ID if legacy else 999999,
        "path": LEGACY_WORKFLOW if legacy else NORMAL_WORKFLOW,
        "event": "push" if legacy else "workflow_dispatch",
        "repository": {"full_name": REPO},
        "head_sha": LEGACY_COMMIT if legacy else NORMAL_SHA,
        "head_branch": "main",
        "status": "completed",
        "conclusion": "success",
        "run_attempt": 1,
    }


def source_assets(run, *, legacy=False):
    return [{
        "id": 777, "name": LEGACY_ARTIFACT if legacy else NORMAL_ARTIFACT,
        "expired": False, "size_in_bytes": 1000,
        "workflow_run": {
            "id": run["id"], "head_sha": run["head_sha"], "head_branch": "main",
        },
    }]


class ProvenanceTests(unittest.TestCase):
    def pin(self, run, asset, artifact_name):
        with patch("scripts.ota_release.subprocess.run") as git:
            result = validate_source(
                run, asset, artifact_name, checkout_sha=MAIN_HEAD,
                git_runner=lambda *args: GRADLE,
            )
            git.assert_called_once()
        return result

    def test_manual_release_from_main(self):
        run = source_run()
        result = self.pin(run, source_assets(run), NORMAL_ARTIFACT)
        self.assertEqual(result["versionCode"], 35)
        self.assertEqual(result["versionName"], "0.20.0")
        self.assertEqual(result["sourceSha"], NORMAL_SHA)

    def test_explicitly_allowed_legacy_signed_release(self):
        run = source_run(legacy=True)
        result = self.pin(run, source_assets(run, legacy=True), LEGACY_ARTIFACT)
        self.assertEqual(result["runId"], LEGACY_RUN_ID)

    def test_wrong_legacy_run_rejected(self):
        run = source_run(legacy=True)
        run["id"] += 1
        with self.assertRaises(PreflightError):
            self.pin(run, source_assets(run, legacy=True), LEGACY_ARTIFACT)

    def test_wrong_workflow_rejected(self):
        run = source_run()
        run["path"] = ".github/workflows/build-apk-from-pr.yml"
        with self.assertRaises(PreflightError):
            self.pin(run, source_assets(run), NORMAL_ARTIFACT)

    def test_non_manual_release_rejected(self):
        run = source_run()
        run["event"] = "push"
        with self.assertRaises(PreflightError):
            self.pin(run, source_assets(run), NORMAL_ARTIFACT)

    def test_wrong_commit_for_artifact_rejected(self):
        run = source_run()
        assets = source_assets(run)
        assets[0]["workflow_run"]["head_sha"] = "3" * 40
        with self.assertRaises(PreflightError):
            self.pin(run, assets, NORMAL_ARTIFACT)

    def test_non_ancestor_rejected(self):
        from subprocess import CalledProcessError
        run = source_run()
        with patch("scripts.ota_release.subprocess.run",
                   side_effect=CalledProcessError(1, ["git"])) as git:
            with self.assertRaises(PreflightError):
                validate_source(run, source_assets(run), NORMAL_ARTIFACT,
                                checkout_sha=MAIN_HEAD, git_runner=lambda *args: GRADLE)

    def test_expired_artifact_rejected(self):
        run = source_run()
        assets = source_assets(run)
        assets[0]["expired"] = True
        with self.assertRaises(PreflightError):
            self.pin(run, assets, NORMAL_ARTIFACT)


class FakeAndroid:
    def __init__(self, *, debuggable=False, signer=CERT):
        self.debuggable = debuggable
        self.signer = signer

    def __call__(self, args):
        if args[0].endswith("/apksigner"):
            return "Signer #1 certificate SHA-256 digest: " + self.signer
        return {
            "application-id": "br.com.atriocatolico",
            "version-code": "35",
            "version-name": "0.20.0",
            "debuggable": "true" if self.debuggable else "false",
        }[args[2]]


class ReleaseManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.apk = root / "original.apk"
        self.apk.write_bytes(b"example of fake signed APK bytes")
        self.sha = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        self.out = root / "dist"
        self.source = {
            "artifactName": NORMAL_ARTIFACT,
            "sourceSha": NORMAL_SHA,
            "versionName": "0.20.0",
            "versionCode": 35,
        }
        self.args = {
            "sdk": root,
            "expected_certificate": CERT,
            "expected_apk_sha256": self.sha,
            "notes": "Correções de segurança e estabilidade.",
            "output": self.out,
            "runner": FakeAndroid(),
        }

    def test_manifest_and_checksums(self):
        manifest = prepare(self.apk, self.source, **self.args)
        saved = json.loads((self.out / "update.json").read_text())
        self.assertEqual(manifest, saved)
        self.assertFalse(saved["mandatory"])
        self.assertEqual(saved["versionCode"], 35)
        self.assertEqual(saved["applicationId"], "br.com.atriocatolico")
        self.assertEqual(saved["apkSha256"], self.sha)
        self.assertEqual(saved["certificateSha256"], CERT)
        self.assertTrue(saved["downloadUrl"].endswith("/v0.20.0/atrio-catolico.apk"))
        self.assertEqual((self.out / "atrio-catolico.apk").read_bytes(), self.apk.read_bytes())
        self.assertIn(self.sha, (self.out / "SHA256SUMS.txt").read_text())
        self.assertEqual((self.out / "source-sha.txt").read_text().strip(), NORMAL_SHA)

    def test_reject_hash_mismatch(self):
        with self.assertRaises(PreflightError):
            prepare(self.apk, self.source,
                    **{**self.args, "expected_apk_sha256": "00" * 32})
        self.assertFalse(self.out.exists())

    def test_reject_wrong_certificate(self):
        with self.assertRaises(PreflightError):
            prepare(self.apk, self.source,
                    **{**self.args, "runner": FakeAndroid(signer="ee" * 32)})

    def test_reject_debuggable_apk(self):
        with self.assertRaises(PreflightError):
            prepare(self.apk, self.source,
                    **{**self.args, "runner": FakeAndroid(debuggable=True)})

    def test_reject_unapproved_artifact(self):
        with self.assertRaises(PreflightError):
            prepare(self.apk, {**self.source, "artifactName": "untrusted"},
                    **self.args)

    def test_reject_missing_release_notes(self):
        with self.assertRaises(PreflightError):
            prepare(self.apk, self.source, **{**self.args, "notes": ""})


class ReleasesOrderTests(unittest.TestCase):
    def test_empty_list_first_release(self):
        self.assertTrue(assert_newer_than_releases("0.20.0", []))

    def test_higher_version_accepted(self):
        self.assertTrue(assert_newer_than_releases("0.20.1", [
            {"tagName": "v0.20.0", "isDraft": False, "isPrerelease": False},
            {"tagName": "v0.19.7", "isDraft": False, "isPrerelease": False},
        ]))

    def test_same_version_refused(self):
        with self.assertRaises(PreflightError):
            assert_newer_than_releases("0.20.0", [
                {"tagName": "v0.20.0", "isDraft": False, "isPrerelease": False},
            ])

    def test_older_version_refused(self):
        with self.assertRaises(PreflightError):
            assert_newer_than_releases("0.19.9", [
                {"tagName": "v0.20.0", "isDraft": False, "isPrerelease": False},
            ])

    def test_unknown_public_tag_refused(self):
        with self.assertRaises(PreflightError):
            assert_newer_than_releases("0.21.0", [
                {"tagName": "release-legacy", "isDraft": False, "isPrerelease": False},
            ])

    def test_published_only_ignores_drafts(self):
        self.assertTrue(assert_newer_than_releases("0.20.0", [
            {"tagName": "v1.0.0", "isDraft": True, "isPrerelease": False},
        ]))

    def test_simple_latest_tag(self):
        self.assertTrue(assert_newer("0.20.1", "v0.20.0"))


if __name__ == "__main__":
    unittest.main()
