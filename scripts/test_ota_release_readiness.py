"""No-secret checks: do not publish legacy or <= private pilot B/0.20.2.

Physical Release pilot A→B ended at 0.20.2/versionCode37, same official signer.
This test does not approve or produce any release.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.ota_apk_preflight import PreflightError
from scripts.ota_release import (
    LEGACY_ARTIFACT, NORMAL_ARTIFACT,
    validate_publication_readiness,
    validate_signing_readiness,
    PILOT_VERIFIED_CODE, PILOT_VERIFIED_NAME,
)

ROOT = Path(__file__).resolve().parents[1]
VALID_SHA = "0123456789abcdef" * 2 + "01234567"


def source(code=38, name="0.20.3", artifact=NORMAL_ARTIFACT):
    return {
        "artifactName": artifact,
        "versionCode": code,
        "versionName": name,
        "sourceSha": VALID_SHA,
    }


class OtaReleaseReadinessTests(unittest.TestCase):
    def test_valid_next_release_must_exceed_verified_pilot(self):
        self.assertEqual((PILOT_VERIFIED_NAME, PILOT_VERIFIED_CODE),
                         ("0.20.2", 37))
        report = validate_publication_readiness(source())
        self.assertEqual(report["versionCode"], 38)
        self.assertEqual(report["versionName"], "0.20.3")
        self.assertFalse(report["public_release_approved"])

    def test_signed_historical_artifact_is_not_app_ota_publication(self):
        with self.assertRaisesRegex(PreflightError, "historico"):
            validate_publication_readiness(
                source(35, "0.20.0", LEGACY_ARTIFACT)
            )

    def test_pilot_current_and_downgrade_are_never_official_updates(self):
        for code in (35, 36, 37):
            with self.subTest(code=code):
                with self.assertRaisesRegex(PreflightError, "versionCode"):
                    validate_publication_readiness(source(code, "0.20.3"))
        for name in ("0.20.0", "0.20.1", "0.20.2"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(PreflightError, "versionName"):
                    validate_publication_readiness(source(38, name))

    def test_type_and_source_are_not_optional(self):
        for metadata in (
            source(code=True),
            source(code="38"),
            source(code=0),
            source(name="0.20.3-rc1"),
            source(name="bad"),
            source(artifact="unknown"),
            {**source(), "sourceSha": ""},
            {},
            None,
        ):
            with self.subTest(metadata=metadata):
                with self.assertRaises((PreflightError, TypeError, ValueError)):
                    validate_publication_readiness(metadata)

    def test_cli_gate_fails_before_any_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            info = Path(tmp) / "source.json"
            for code, name, expected in (
                (38, "0.20.3", 0),
                (36, "0.20.1", 1),
                (37, "0.20.2", 1),
            ):
                info.write_text(json.dumps(source(code, name)))
                result = subprocess.run(
                    [sys.executable, "-m", "scripts.ota_release",
                     "publish-readiness", "--source-json", str(info)],
                    cwd=ROOT, capture_output=True, text=True, timeout=12
                )
                self.assertEqual(
                    result.returncode, expected,
                    f"code={code}: {result.stdout} {result.stderr}",
                )
                if expected == 1:
                    self.assertIn("Publicação OTA bloqueada", result.stderr)

    def test_current_main_release_is_not_ready_to_sign(self):
        # Physical pilot B uses versionCode 37, while normal Release still has 36.
        with self.assertRaisesRegex(PreflightError, "versionCode"):
            validate_signing_readiness(ROOT / "app/build.gradle.kts")
        result = subprocess.run(
            [sys.executable, "-m", "scripts.ota_release", "signing-readiness",
             "--gradle-file", str(ROOT / "app/build.gradle.kts")],
            cwd=ROOT, capture_output=True, text=True, timeout=12
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Publicação OTA bloqueada", result.stderr)

    def test_future_signing_requires_matching_gradle_package_and_version(self):
        def gradle(code, name, app_id="br.com.atriocatolico"):
            return ('android {\n'
                    '    defaultConfig {\n'
                    f'        applicationId = "{app_id}"\n'
                    f'        versionCode = {code}\n'
                    f'        versionName = "{name}"\n'
                    '    }\n'
                    '}\n')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "build.gradle.kts"
            path.write_text(gradle(38, "0.20.3"), encoding="utf-8")
            report = validate_signing_readiness(path)
            self.assertEqual(report["versionCode"], 38)
            self.assertFalse(report["signing_authorized"])
            for code, name, package in [
                (36, "0.20.1", "br.com.atriocatolico"),
                (37, "0.20.2", "br.com.atriocatolico"),
                (38, "0.20.2", "br.com.atriocatolico"),
                (38, "0.20.3", "br.com.estranho"),
            ]:
                path.write_text(gradle(code, name, package), encoding="utf-8")
                with self.subTest(code=code, name=name, package=package):
                    with self.assertRaises(PreflightError):
                        validate_signing_readiness(path)

    def test_publication_workflow_guardian_and_version_guards(self):
        publisher = (ROOT / ".github/workflows/ota-publish-release.yml").read_text()
        build = (ROOT / ".github/workflows/build-apk.yml").read_text()
        self.assertIn("python3 -m scripts.ota_release publish-readiness", publisher)
        self.assertIn("if: inputs.mode == 'publish'", publisher)
        self.assertIn("vars.ATRIO_GUARDIAN_V2_RELEASE_APPROVED == 'true'", publisher)
        self.assertIn("ATRIO_GUARDIAN_V2_RELEASE_APPROVED", publisher)
        self.assertIn("ATRIO_GUARDIAN_V2_WORKER_URL", publisher)
        self.assertIn("d[\"versionCode\"] > 37", publisher)
        self.assertIn("version_tuple(\"0.20.2\")", publisher)
        self.assertIn(
            "needs.validate-release.outputs.artifact_name == 'atrio-catolico-release-assinado'",
            publisher,
        )
        self.assertIn('if [[ "$ATRIO_GUARDIAN_V2_RELEASE_APPROVED" != "true" ]]', build)
        self.assertIn('if [[ "$ATRIO_OTA_E2E_TESTED" != "true" ]]', build)
        self.assertIn('if [[ "$ATRIO_OTA_RELEASE_APPROVED" != "true" ]]', build)
        self.assertIn(
            "python3 -m scripts.ota_release signing-readiness", build
        )
        self.assertNotIn("gh release create", build)


if __name__ == "__main__":
    unittest.main()
