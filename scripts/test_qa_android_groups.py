#!/usr/bin/env python3
"""Checks for parallel Android QA partition, without executing a device."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
GROUPS = {
    "profiles": ["GuardianSessionUiTest","ProfileLayoutUiTest","ProfilePhotoUiTest","ProfileEditorUiTest","DesignV2UiTest","EmailVerificationAndroidUiTest"],
    "interaction": ["EngagementUiTest","ReactionEmojiUiTest","DiscussionDetailV2UiTest","AtrioTypographyAccessibilityUiTest"],
    "bots": ["ThreeBotsAndroidUiTest","ThreeBotsAuthenticatedAndroidUiTest","ThreeBotsOnlineEmulatorTest"],
}

class AndroidGroupTests(unittest.TestCase):
    def test_complete_disjoint_partition(self):
        source = (ROOT / "scripts/run-qa-android-emulator.sh").read_text()
        calls = re.findall(r"(?m)^\s*run_suite ([A-Za-z][A-Za-z0-9]+)$", source)
        self.assertEqual(len(calls), 14)
        self.assertEqual(len(calls), len(set(calls)))
        self.assertIn("GuardianV2UiTest", calls)
        pairs = re.findall(r"(profiles|interaction|bots):([A-Za-z][A-Za-z0-9]+)", source)
        self.assertEqual(len(pairs), 13)
        self.assertEqual(len(pairs), len(set(pairs)))
        for group, suites in GROUPS.items():
            self.assertEqual({x for g, x in pairs if g == group}, set(suites))
        self.assertEqual(set(calls) - {"GuardianV2UiTest"}, {x for v in GROUPS.values() for x in v})

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
        self.assertIn('name: qa-bots-android-ui-reports-${{ matrix.suite_group }}', source)

if __name__ == "__main__":
    unittest.main()
