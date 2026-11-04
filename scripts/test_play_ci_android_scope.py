import unittest
from play_ci_android_scope import requires_android_build


class BuildScopeTests(unittest.TestCase):
    def test_android_sources_and_build_rules_always_compile(self):
        for path in (
            "app/src/main/java/br/com/atriocatolico/MainActivity.kt",
            "app/google-services.json", "gradle/wrapper/gradle-wrapper.properties",
            "build.gradle.kts", "settings.gradle.kts", "gradle.properties",
            ".github/workflows/play-closed-aab-ci.yml",
            ".github/workflows/play-signed-aab-manual.yml",
            "scripts/play_store_bundle_check.py",
            "scripts/play_release_gate.py",
            "scripts/play_ci_android_scope.py",
        ):
            with self.subTest(path=path):
                self.assertTrue(requires_android_build([path]))

    def test_isolated_privacy_and_docs_changes_skip_only_android_build(self):
        self.assertFalse(requires_android_build([
            "cloudflare/privacy-batch-stage/src/index.js",
            "cloudflare/account-deletion-audit/src/qa-cloud-stage.test.js",
            "docs/google-play-privacidade-evidencias.json",
            "docs/google-play-ugc-evidencias.json",
            "tests/security/community-terms.test.mjs",
            "scripts/test_play_release_gate.py",
            "scripts/play_listing_preflight.py",
            "scripts/test_play_listing_preflight.py",
            "fastlane/metadata/android/pt-BR/title.txt",
        ]))

    def test_any_android_path_wins_over_docs(self):
        self.assertTrue(requires_android_build([
            "docs/google-play-entrega-final-e-pendencias.md",
            "app/src/main/AndroidManifest.xml",
        ]))

    def test_unknown_malformed_or_empty_diff_never_skips(self):
        for paths in (None, [], [""], ["some/unknown.file"],
                      [".github/workflows/unknown.yml"], ["scripts/activate.py"],
                      ["docs/x.md\nandroid=false"], ["\x00"]):
            with self.subTest(paths=paths):
                self.assertTrue(requires_android_build(paths))


if __name__ == "__main__":
    unittest.main()
