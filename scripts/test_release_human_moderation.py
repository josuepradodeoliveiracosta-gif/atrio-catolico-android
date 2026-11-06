"""Safety regressions for opt-in public Release with human moderation.

The fallback does not claim Guardian V2 production homologation.
Tests run without Android SDK, secrets, release signing or publication.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD = (ROOT / ".github/workflows/build-apk.yml").read_text(encoding="utf-8")
PUBLISH = (ROOT / ".github/workflows/ota-publish-release.yml").read_text(encoding="utf-8")
GRADLE = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")


class HumanModerationReleaseTests(unittest.TestCase):
    def test_human_mode_is_explicit_opt_in_and_unknown_mode_is_denied(self):
        for workflow in (BUILD, PUBLISH):
            self.assertIn("ATRIO_RELEASE_MODERATION_MODE", workflow)
            self.assertIn("vars.ATRIO_RELEASE_MODERATION_MODE || 'guardian_v2'", workflow)
            self.assertIn('case "$ATRIO_RELEASE_MODERATION_MODE" in', workflow)
            self.assertIn("guardian_v2)", workflow)
            self.assertIn("human)", workflow)
            self.assertIn("exit 1", workflow)
        self.assertIn('if [[ "$ATRIO_GUARDIAN_V2_RELEASE_APPROVED" != "true" ]]', BUILD)
        self.assertIn('[[ "$ATRIO_GUARDIAN_V2_RELEASE_APPROVED" == "true" ]]', PUBLISH)
        self.assertNotIn("ATRIO_GUARDIAN_V2_RELEASE_APPROVED=true", BUILD+PUBLISH)

    def test_human_mode_disables_guardian_v2_endpoint_inside_release_apk(self):
        release = GRADLE.split('getByName("release") {', 1)[1].split(
            'create("otaPilot")', 1
        )[0]
        self.assertIn(
            'if (System.getenv("ATRIO_RELEASE_MODERATION_MODE") == "human")',
            release,
        )
        self.assertIn(
            'buildConfigField("String", "GUARDIAN_V2_WORKER_URL", "\\"\\"")',
            release,
        )
        for name in ("UserReportsAdminPanel.kt", "ModerationScreen.kt", "BlockedMembers.kt"):
            self.assertTrue((ROOT / "app/src/main/java/br/com/atriocatolico" / name).exists())

    def test_ota_and_email_gates_are_still_required_independently(self):
        for wf in (BUILD, PUBLISH):
            for name in (
                "ATRIO_OTA_E2E_TESTED",
                "ATRIO_OTA_RELEASE_APPROVED",
                "ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED",
            ):
                with self.subTest(gate=name, workflow="build" if wf == BUILD else "publish"):
                    self.assertIn("vars." + name, wf)
                    self.assertIn('"$' + name + '"', wf)
        self.assertIn("github.event_name == 'workflow_dispatch'", BUILD)
        self.assertIn("inputs.confirmation == 'PUBLICAR ATRIO'", PUBLISH)
        self.assertNotIn("  push:", PUBLISH)
        self.assertNotIn("  schedule:", PUBLISH)

    def test_signed_apk_mode_is_attested_and_must_match_publication(self):
        official_sign = BUILD.split(
            "- name: Compilar APK release com chave permanente (quando configurada)", 1
        )[1]
        self.assertIn("release-moderation-mode.txt", official_sign)
        self.assertLess(
            official_sign.index("python3 -m scripts.ota_release_cert"),
            official_sign.index("release-moderation-mode.txt"),
        )
        self.assertIn("app/build/outputs/apk/release/release-moderation-mode.txt", BUILD)
        self.assertIn("ota-original/release-moderation-mode.txt", PUBLISH)
        self.assertIn(
            '[[ "$(cat ota-original/release-moderation-mode.txt)" == "$ATRIO_RELEASE_MODERATION_MODE" ]]',
            PUBLISH,
        )
        self.assertIn("cp ota-original/release-moderation-mode.txt dist/release-moderation-mode.txt", PUBLISH)
        self.assertIn("needs.validate-release.outputs.moderation_mode", PUBLISH)
        self.assertIn("needs.validate-release.outputs.artifact_name == 'atrio-catolico-release-assinado'", PUBLISH)
        self.assertIn(
            '[[ "$(cat dist/release-moderation-mode.txt)" == "$ATRIO_RELEASE_MODERATION_MODE" ]]',
            PUBLISH,
        )
        self.assertIn('d["versionCode"] > 37', PUBLISH)
        self.assertIn("sha256sum --check SHA256SUMS.txt", PUBLISH)

    def test_no_automatic_publication_or_credentials_in_app(self):
        self.assertNotIn("gh release create", BUILD)
        self.assertIn("gh release create", PUBLISH)
        self.assertIn("gh release edit", PUBLISH)
        self.assertIn("if: inputs.mode == 'publish'", PUBLISH)
        self.assertNotIn("ATRIO_KEYSTORE_BASE64", GRADLE)
        self.assertNotIn("ATRIO_STORE_PASSWORD", GRADLE)


if __name__ == "__main__":
    unittest.main()
