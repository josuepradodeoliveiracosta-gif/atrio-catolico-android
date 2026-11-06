"""Prevent regression from encrypted manual pilot signing to public APK distribution."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / ".github/workflows/ota-pilot-signed-encrypted.yml"
NORMAL_BUILD = ROOT / ".github/workflows/build-apk.yml"
OFFICIAL_PUBLISH = ROOT / ".github/workflows/ota-publish-release.yml"


class PilotSignedWorkflowSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wf = PILOT.read_text(encoding="utf-8")

    def test_manual_only_and_owner_main_only(self):
        self.assertRegex(self.wf, r"(?m)^on:\s*\n  workflow_dispatch:\s*\n")
        for forbidden in (r"(?m)^  push:", r"(?m)^  pull_request:",
                          r"(?m)^  schedule:", r"(?m)^  workflow_run:",
                          r"(?m)^  repository_dispatch:"):
            self.assertNotRegex(self.wf, forbidden)
        for must in ("github.actor == 'josuepradodeoliveiracosta-gif'",
                     "github.ref == 'refs/heads/main'",
                     "github.run_attempt == 1", "github.event_name == 'workflow_dispatch'",
                     "inputs.confirmation == 'HOMOLOGAR ATRIO SEM PUBLICAR'",
                     "environment: ota-pilot-homologacao"):
            self.assertIn(must, self.wf)

    def test_public_repo_never_exports_plaintext_apk(self):
        self.assertIn("age -r", self.wf)
        self.assertIn("age_public_recipient", self.wf)
        self.assertIn('[[ "$AGE_PUBLIC_RECIPIENT" =~ ^age1[a-z0-9]{58}$ ]]', self.wf)
        self.assertIn("encrypted-output/atrio-ota-piloto-ab.zip.age", self.wf)
        self.assertIn("retention-days: 1", self.wf)
        self.assertIn('trap \'rm -f "$KEYSTORE" "$RUNNER_TEMP/atrio-ota-pilot-bundle.zip"', self.wf)
        upload = self.wf.split("uses: actions/upload-artifact@v4", 1)[1]
        self.assertIn("path: encrypted-output/atrio-ota-piloto-ab.zip.age", upload)
        self.assertNotIn("*.apk", upload)
        self.assertNotIn("base.apk", upload)
        self.assertNotIn("candidate.apk", upload)
        self.assertNotIn("ota-pilot-staging", upload)

    def test_sign_only_pilot_and_verify_pin_no_publish(self):
        self.assertIn("gradle :app:assembleOtaPilot", self.wf)
        self.assertEqual(self.wf.count("gradle :app:assembleOtaPilot"), 1)
        self.assertIn('"36 0.20.1 base" "37 0.20.2 candidate"', self.wf)
        self.assertIn("python3 scripts/ota_release_cert.py", self.wf)
        self.assertIn("python3 scripts/ota_release_pair_preflight.py", self.wf)
        self.assertIn("python3 scripts/ota_release_pilot_server.py", self.wf)
        self.assertIn("ATRIO_OTA_PILOT_CONFIRM", self.wf)
        self.assertIn("ATRIO_OTA_RELEASE_PILOT=1", self.wf)
        for forbidden in ("gradle :app:assembleRelease", "gh release create",
                          "gh release edit", "contents: write",
                          "ATRIO_OTA_E2E_TESTED=true", "ATRIO_OTA_RELEASE_APPROVED=true",
                          "git push", "firebase deploy", "wrangler deploy"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.wf)

    def test_official_gates_remain_inseparable(self):
        normal = NORMAL_BUILD.read_text(encoding="utf-8")
        publish = OFFICIAL_PUBLISH.read_text(encoding="utf-8")
        for flag in ("ATRIO_OTA_E2E_TESTED", "ATRIO_OTA_RELEASE_APPROVED"):
            self.assertIn(flag, normal)
            self.assertIn(flag, publish)
        self.assertIn("gradle :app:assembleRelease", normal)
        self.assertIn("gh release create", publish)
        self.assertIn("permissions:\n  contents: read", self.wf)


if __name__ == "__main__":
    unittest.main()
