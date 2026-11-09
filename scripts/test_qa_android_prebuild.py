#!/usr/bin/env python3
"""Testa o contrato do prebuild sem Android, Firebase nem Gradle real."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name("qa-android-prebuild.sh")


class QaAndroidPrebuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        (self.root / "app").mkdir()
        (self.root / "bin").mkdir()
        self.script = self.root / "scripts/qa-android-prebuild.sh"
        shutil.copyfile(SOURCE, self.script)
        fake = self.root / "bin/gradle"
        fake.write_text(
            '#!/usr/bin/env bash\n'
            'echo "BUILD SUCCESSFUL in teste offline"\n'
            'exit "${QA_FAKE_RESULT:-0}"\n',
            encoding="utf-8",
        )
        fake.chmod(0o755)
        self.env = dict(os.environ)
        self.env["PATH"] = str(self.root / "bin") + os.pathsep + self.env.get("PATH", "")

    def call_script(self, command):
        return subprocess.run(
            ["bash", str(self.script), command],
            env=self.env, cwd=self.root, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=20,
        )

    def test_success_waits_for_apks_before_tests(self):
        self.assertEqual(self.call_script("start").returncode, 0)
        completed = self.call_script("await")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual((self.root / "qa-android-prebuild.status").read_text().strip(), "0")
        self.assertIn("prebuild aprovado", completed.stdout)

    def test_failure_blocks_instrumentation(self):
        self.env["QA_FAKE_RESULT"] = "17"
        self.assertEqual(self.call_script("start").returncode, 0)
        completed = self.call_script("await")
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual((self.root / "qa-android-prebuild.status").read_text().strip(), "17")

    def test_old_workflows_without_prebuild_still_work(self):
        self.assertEqual(self.call_script("await").returncode, 0)

    def test_reject_firebase_production_file(self):
        (self.root / "app/google-services.json").write_text("{}", encoding="utf-8")
        completed = self.call_script("start")
        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse((self.root / "qa-android-prebuild.pid").exists())

    def test_reject_repeated_start_and_unknown_mode(self):
        self.assertEqual(self.call_script("start").returncode, 0)
        self.assertNotEqual(self.call_script("start").returncode, 0)
        self.assertNotEqual(self.call_script("unknown").returncode, 0)
        self.assertEqual(self.call_script("await").returncode, 0)


if __name__ == "__main__":
    unittest.main()
