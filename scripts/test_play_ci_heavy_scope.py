import unittest
from play_ci_heavy_scope import requires_heavy_emulators

class HeavyEmulatorScopeTests(unittest.TestCase):
    def test_known_review_only_paths_skip_emulators(self):
        self.assertFalse(requires_heavy_emulators([
            "docs/google-play-caminho-critico-acelerado.md",
            "cloudflare/account-deletion-support/site-bundle.test.mjs",
            "cloudflare/account-deletion-audit/src/qa-moderation-case-review.js",
            "cloudflare/account-deletion-audit/src/qa-moderation-deletion-preflight.test.js",
        ]))

    def test_runtime_security_build_and_workflow_changes_always_test(self):
        for path in (
            "firestore.rules",
            "app/src/main/java/br/com/atriocatolico/MainActivity.kt",
            "app/src/androidTest/java/br/com/atriocatolico/GuardianV2UiTest.kt",
            "tests/security/qa-deletion-emulator.test.mjs",
            "cloudflare/account-deletion-audit/src/deletion-orchestrator.js",
            "cloudflare/account-deletion-audit/src/qa-retention-source-registry.js",
            "cloudflare/account-deletion-portal/public/app.js",
            "cloudflare/privacy-freeze-stage/src/index.js",
            "cloudflare/push-worker/src/index.js",
            "cloudflare/guardian-worker/src/index.js",
            "cloudflare/account-deletion-processor/src/plan.js",
            "gradle.properties",
            "scripts/play_ci_heavy_scope.py",
            "scripts/test_play_ci_heavy_scope.py",
            ".github/workflows/selos-ci.yml",
            ".github/workflows/guardiao-v2-android-ui-ci.yml",
            ".github/workflows/guardiao-v2-fluxo-emulador-ci.yml",
            ".github/workflows/play-closed-aab-ci.yml",
        ):
            with self.subTest(path=path):
                self.assertTrue(requires_heavy_emulators([path]))
                self.assertTrue(requires_heavy_emulators(["docs/x.md", path]))

    def test_empty_malformed_or_unknown_paths_fail_closed(self):
        for names in (
            None, [], [""], ["unknown.file"],
            [".github/workflows/other.yml"], ["docs/../firestore.rules"],
            ["docs//bad.md"], ["/docs/absolute.md"],
            ["docs/x.md\nheavy=false"], ["docs/x.md\r"],
            ["docs\\x.md"], ["docs/."], ["docs/" + "a" * 1100],
            ["docs/file.md"] * 1001
        ):
            with self.subTest(names=str(names)[:100]):
                self.assertTrue(requires_heavy_emulators(names))

if __name__ == "__main__":
    unittest.main()
