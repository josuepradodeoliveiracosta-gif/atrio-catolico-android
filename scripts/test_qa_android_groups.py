#!/usr/bin/env python3
"""Checks for parallel Android QA partition, without executing a device."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
GROUPS = {
    "profiles": ["GuardianSessionUiTest","ProfileLayoutUiTest","ProfilePhotoUiTest","ProfileEditorUiTest","DesignV2UiTest","EmailVerificationAndroidUiTest","PerfilQaSaveEmulatorTest"],
    "interaction": ["EngagementUiTest","ReactionEmojiUiTest","DiscussionDetailV2UiTest","AtrioTypographyAccessibilityUiTest","LoginLiturgicalBackdropUiTest","WelcomeVitralUiTest","ParticipationVitralUiTest"],
    "bots": ["ThreeBotsAndroidUiTest","ThreeBotsAuthenticatedAndroidUiTest","ThreeBotsOnlineEmulatorTest","AtrioConversasCompostasEmulatorUiTest","AtrioConversasNavegacaoEmulatorUiTest","AtrioConversasForaDaConfiguracaoEmulatorUiTest","AtrioConversasTrocaContaEmulatorUiTest"],
}
FOCAL_ROUTES = {
    'if [[ "${ATRIO_QA_SUITE:-}" == ProfileV3ConsentEmulatorUiTest ]]; then': (
        "WelcomeVitralTalkBackUiTest",
        "ParticipationVitralTalkBackUiTest",
    ),
    'if [[ "${ATRIO_QA_SUITE:-}" == "GuardianV2UiTest" ]]; then': (
        "GuardianV2UiTest",
    ),
    'if [[ "$notice_focal" == 1 ]]; then': (
        "QaConversationNoticeDeniedAndroidTest",
        "QaConversationNoticeGrantedAndroidTest",
        "QaConversationNoticeSessionAndroidTest",
        "QaConversationNoticeRevokedAndroidTest",
    ),
}
ITEM15_ROUTES = {
    "age18": (
        "QaConversationNoticeAge18RestoredAndroidTest",
        "QaConversationNoticeAge18ReRevokedAndroidTest",
        "QaConversationNoticeAge18ReverseAndroidTest",
    ),
    "lucia": ("QaConversationNoticeThirdBotAndroidTest",),
}
SUITE_CALL = re.compile(r"(?m)^[ \t]*run_suite ([A-Za-z][A-Za-z0-9]+)$")

class AndroidGroupTests(unittest.TestCase):
    def test_complete_disjoint_partition(self):
        source = (ROOT / "scripts/run-qa-android-emulator.sh").read_text()
        calls = SUITE_CALL.findall(source)
        self.assertEqual(len(calls), len(set(calls)))
        matrix = [(group, suite) for group, suites in GROUPS.items() for suite in suites]
        focal = [suite for suites in FOCAL_ROUTES.values() for suite in suites]
        item15 = [suite for suites in ITEM15_ROUTES.values() for suite in suites]
        self.assertCountEqual(calls, [suite for _, suite in matrix] + focal + item15)

        pairs = re.findall(r"(profiles|interaction|bots):([A-Za-z][A-Za-z0-9]+)", source)
        self.assertCountEqual(pairs, matrix)

    def test_focal_suites_stay_on_their_selected_routes(self):
        source = (ROOT / "scripts/run-qa-android-emulator.sh").read_text()
        for guard, suites in FOCAL_ROUTES.items():
            with self.subTest(guard=guard):
                block = re.search(rf"(?ms)^{re.escape(guard)}\n(.*?)^fi$", source)
                self.assertIsNotNone(block, guard)
                found = SUITE_CALL.findall(block[1])
                if "notice_focal" in guard:
                    item15_all = [s for suites in ITEM15_ROUTES.values() for s in suites]
                    routing_marker = '  case "${ATRIO_QA_ITEM15_CASE:-}" in'
                    self.assertIn(routing_marker, block[1])
                    routing = block[1].split(routing_marker, 1)[1].split("  esac", 1)[0]
                    self.assertCountEqual([s for s in found if s in item15_all], item15_all)
                    for name, expected in ITEM15_ROUTES.items():
                        scenario = re.search(
                            rf'(?ms)^    {name}\)\n(.*?)^      ;;$',
                            routing,
                        )
                        self.assertIsNotNone(scenario, name)
                        self.assertEqual(SUITE_CALL.findall(scenario[1]), list(expected))
                    found = [s for s in found if s not in item15_all]
                self.assertEqual(found, list(suites))
                self.assertRegex(block[1], r'(?m)^  exit "\$qa_failed"$')

    def test_participation_focal_keeps_offline_and_captures(self):
        source = (ROOT / "scripts/run-qa-android-emulator.sh").read_text()
        start = 'if [[ "${ATRIO_QA_SUITE:-}" == ParticipationVitralUiTest ]]; then'
        block = source.split(start, 1)[1].split("\nfi", 1)[0]
        self.assertIn("run_suite ParticipationVitralUiTest -Pandroid.testInstrumentationRunnerArguments.atrioOfflineVitralQa=true", block)
        self.assertIn("atrio-participation-preview", block)
        self.assertIn('exit "$qa_failed"', block)

    def test_legacy_and_captures(self):
        source = (ROOT / "scripts/run-qa-android-emulator.sh").read_text()
        self.assertIn('qa_group="${ATRIO_QA_SUITE_GROUP:-all}"', source)
        self.assertIn('if [[ "$qa_group" != "all" ]]', source)
        self.assertIn('"$qa_group" == "interaction"', source)
        self.assertIn('"$qa_group" == "profiles"', source)
        self.assertIn('"${ATRIO_QA_SUITE:-}" == "GuardianV2UiTest"', source)

    def test_matrix_and_artifacts(self):
        source = (ROOT / ".github/workflows/android-bots-ui.yml").read_text()
        self.assertIn("fail-fast: false", source)
        self.assertIn("max-parallel: 3", source)
        self.assertIn("suite_group: [profiles, interaction, bots]", source)
        self.assertIn('ATRIO_QA_SUITE_GROUP: ${{ matrix.suite_group }}', source)
        self.assertIn('ATRIO_QA_APK: qaGeral', source)
        self.assertIn("ATRIO_QA_GERAL_BUILD: '1'", source)
        self.assertIn('ATRIO_QA_FIREBASE_PROJECT: demo-atrio-v11', source)
        self.assertIn('name: qa-bots-android-ui-reports-${{ matrix.suite_group }}', source)

if __name__ == "__main__":
    unittest.main()
