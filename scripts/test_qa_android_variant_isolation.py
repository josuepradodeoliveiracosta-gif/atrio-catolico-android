#!/usr/bin/env python3
"""Contratos offline: bots completos somente no APK QA Geral com Firebase Emulator."""
from pathlib import Path
import os
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


class QaGeralBotIsolationTests(unittest.TestCase):
    def test_gradle_has_separate_opt_in_build_and_keeps_chat_profile(self):
        gradle = source("app/build.gradle.kts")
        for expected in (
            'create("qaGeral")', 'applicationIdSuffix = ".qageral"',
            'testBuildType = if (atrioQaGeralBuild) "qaGeral" else "debug"',
            'variant.enable = atrioQaGeralBuild',
            'create("chatQa")', 'create("perfilQa")',
            'applicationIdSuffix = ".chatqa"',
            'applicationIdSuffix = ".perfilqa"',
            'file(it).exists()',
            'add("qaGeralImplementation", "androidx.compose.ui:ui-test-manifest")',
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, gradle)
        for must_keep in ('getByName("debug")', 'getByName("release")',
                          'create("otaPilot")'):
            self.assertIn(must_keep, gradle)

    def test_workflow_routes_bots_to_local_qa_geral(self):
        ci = source(".github/workflows/android-bots-ui.yml")
        for expected in (
            'suite_group: [profiles, interaction, bots]',
            'ATRIO_QA_APK: qaGeral',
            "ATRIO_QA_GERAL_BUILD: '1'",
            'ATRIO_QA_FIREBASE_PROJECT: demo-atrio-v11',
            'app/src/qaGeral/**',
            'test ! -e app/google-services.json',
        ):
            self.assertIn(expected, ci)
        self.assertNotIn("secrets.", ci)
        self.assertNotIn("firebase deploy", ci)
        self.assertNotIn("pull_request_target", ci)

    def test_runner_and_prebuild_use_qa_apk(self):
        runner = source("scripts/run-qa-android-emulator.sh")
        prebuild = source("scripts/qa-android-prebuild.sh")
        self.assertIn('test_task=":app:connectedQaGeralAndroidTest"', runner)
        self.assertIn('test_task=":app:connectedDebugAndroidTest"', runner)
        self.assertIn("Suite de bot recusada fora do APK QA Geral", runner)
        self.assertIn("Tres bots completos: permitido somente APK QA Geral", runner)
        self.assertIn("--project demo-atrio-v11", runner)
        self.assertIn(":app:assembleQaGeral :app:assembleQaGeralAndroidTest", prebuild)
        self.assertIn(":app:assembleDebug :app:assembleDebugAndroidTest", prebuild)

    def test_each_bot_suite_validates_apk_identity(self):
        root = "app/src/androidTest/java/br/com/atriocatolico/"
        for file in ("ThreeBotsAndroidUiTest.kt",
                     "ThreeBotsAuthenticatedAndroidUiTest.kt",
                     "ThreeBotsOnlineEmulatorTest.kt"):
            with self.subTest(file=file):
                kotlin = source(root + file)
                self.assertIn('"br.com.atriocatolico.qageral"', kotlin)
                self.assertIn("BuildConfig.APPLICATION_ID", kotlin)

    def test_restricted_variant_tests_still_run_without_bots(self):
        selos = source(".github/workflows/selos-ci.yml")
        self.assertIn("scripts.test_chat_qa_build_gate", selos)
        self.assertIn("scripts.test_perfil_qa_build_gate", selos)
        self.assertIn("scripts.test_ag7_qa_variants_contract", selos)
        manifest = source("app/src/qaGeral/AndroidManifest.xml")
        self.assertIn('tools:node="remove"', manifest)
        self.assertIn('android:allowBackup="false"', manifest)

    def test_debug_cannot_run_bots_before_starting_emulators(self):
        env = dict(os.environ)
        env.update(ATRIO_QA_APK="debug", ATRIO_QA_SUITE_GROUP="bots")
        p = subprocess.run(
            ["bash", str(ROOT / "scripts/run-qa-android-emulator.sh")],
            cwd=ROOT, env=env, text=True, capture_output=True, timeout=5
        )
        self.assertEqual(p.returncode, 2)
        self.assertIn("somente APK QA Geral", p.stderr)

    def test_wrong_project_cannot_run_bots_before_starting_emulators(self):
        env = dict(os.environ)
        env.update(
            ATRIO_QA_APK="qaGeral", ATRIO_QA_SUITE_GROUP="bots",
            ATRIO_QA_GERAL_BUILD="1",
            ATRIO_QA_FIREBASE_PROJECT="atrio-catolico",
        )
        p = subprocess.run(
            ["bash", str(ROOT / "scripts/run-qa-android-emulator.sh")],
            cwd=ROOT, env=env, text=True, capture_output=True, timeout=5
        )
        self.assertEqual(p.returncode, 2)
        self.assertIn("demo-atrio-v11", p.stderr)


if __name__ == "__main__":
    unittest.main()
