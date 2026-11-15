#!/usr/bin/env python3
"""Contratos offline: bots completos somente no APK QA Geral com Firebase Emulator."""
from pathlib import Path
import os
import subprocess
import unittest
import xml.etree.ElementTree as ET

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

    def test_qa_geral_cleartext_allowlist_is_exactly_two_emulator_hosts(self):
        manifest = ET.fromstring(source("app/src/qaGeral/AndroidManifest.xml"))
        android_ns = "{http://schemas.android.com/apk/res/android}"
        app = manifest.find("application")
        self.assertIsNotNone(app)
        self.assertEqual(
            app.attrib.get(android_ns + "networkSecurityConfig"),
            "@xml/qa_emulator_network_security",
        )
        self.assertNotIn(android_ns + "usesCleartextTraffic", app.attrib)

        qa_config = ET.fromstring(
            source("app/src/qaGeral/res/xml/qa_emulator_network_security.xml")
        )
        self.assertEqual(qa_config.tag, "network-security-config")
        self.assertEqual(len(qa_config), 2)
        base = qa_config.find("base-config")
        self.assertIsNotNone(base)
        self.assertEqual(base.attrib, {"cleartextTrafficPermitted": "false"})
        domain_configs = qa_config.findall("domain-config")
        self.assertEqual(len(domain_configs), 1)
        allowed = domain_configs[0]
        self.assertEqual(allowed.attrib, {"cleartextTrafficPermitted": "true"})
        hosts = allowed.findall("domain")
        self.assertEqual(
            {node.text for node in hosts},
            {"127.0.0.1", "10.0.2.2"},
        )
        self.assertEqual(len(hosts), 2)
        self.assertTrue(
            all(node.attrib == {"includeSubdomains": "false"} for node in hosts)
        )

        # Debug preserva a politica original; o Manifest oficial nao e alterado.
        debug_config = ET.fromstring(
            source("app/src/debug/res/xml/qa_emulator_network_security.xml")
        )
        debug_hosts = {
            node.text
            for node in debug_config.findall("./domain-config/domain")
        }
        self.assertEqual(debug_hosts, {"127.0.0.1", "10.0.2.2"})
        self.assertNotIn("networkSecurityConfig",
                         source("app/src/main/AndroidManifest.xml"))
        self.assertNotIn("networkSecurityConfig",
                         source("app/src/perfilQa/AndroidManifest.xml"))
        self.assertNotIn("networkSecurityConfig",
                         source("app/src/chatQa/AndroidManifest.xml"))

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
