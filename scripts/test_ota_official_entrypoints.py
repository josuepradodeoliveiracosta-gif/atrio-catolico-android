"""Regression tests for OTA workflow Python entrypoints, no Android SDK/secrets.

The real pilot run #1 failed with ModuleNotFoundError because executing
"python3 scripts/foo.py" breaks imports of "scripts.*" on GitHub runners.
These checks cover all read-only and official publish pipeline entrypoints
without signing APKs or accessing production.
"""
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github/workflows"

ENTRYPOINTS = {
    "build-apk.yml": ["scripts.ota_release_cert"],
    "ota-publish-release.yml": ["scripts.ota_release"],
    "ota-apk-preflight.yml": [
        "scripts.ota_apk_preflight", "scripts.ota_baseline_0200",
    ],
    "ota-release-pair-preflight.yml": ["scripts.ota_release_pair_preflight"],
}


class OtaOfficialEntrypointTests(unittest.TestCase):
    def test_each_workflow_calls_modules_not_files(self):
        for filename, modules in ENTRYPOINTS.items():
            source = (WORKFLOWS / filename).read_text(encoding="utf-8")
            for module in modules:
                with self.subTest(workflow=filename, module=module):
                    self.assertNotIn("python3 " + module.replace(".", "/") + ".py", source)
                    if filename == "ota-release-pair-preflight.yml":
                        self.assertIn(
                            'sys.executable, "-m", "scripts.ota_release_pair_preflight"',
                            source,
                        )
                        self.assertNotIn(
                            'sys.executable, "scripts/ota_release_pair_preflight.py"',
                            source,
                        )
                    else:
                        self.assertIn("python3 -m " + module, source)

    def test_all_modules_are_importable_and_have_safe_help(self):
        modules = sorted({m for ms in ENTRYPOINTS.values() for m in ms})
        for module in modules:
            with self.subTest(module=module):
                result = subprocess.run(
                    [sys.executable, "-m", module, "--help"],
                    cwd=ROOT, capture_output=True, text=True,
                    timeout=12, check=False,
                )
                self.assertEqual(
                    result.returncode, 0,
                    f"{module}: {result.stderr}",
                )
                self.assertIn("usage:", result.stdout)

    def test_release_version_preflight_success_and_downgrade_failure(self):
        prefix = [sys.executable, "-m", "scripts.ota_release", "newer"]
        newer = subprocess.run(
            prefix + ["--version", "0.20.2", "--latest-tag", "v0.20.1"],
            cwd=ROOT, capture_output=True, text=True, timeout=12,
        )
        self.assertEqual(newer.returncode, 0, newer.stderr)
        older = subprocess.run(
            prefix + ["--version", "0.20.1", "--latest-tag", "v0.20.2"],
            cwd=ROOT, capture_output=True, text=True, timeout=12,
        )
        self.assertNotEqual(older.returncode, 0)
        self.assertIn("Publicação OTA bloqueada", older.stderr)

    def test_official_workflows_retain_release_publication_gates(self):
        signer = (WORKFLOWS / "build-apk.yml").read_text(encoding="utf-8")
        publisher = (WORKFLOWS / "ota-publish-release.yml").read_text(
            encoding="utf-8"
        )
        for gate in ("ATRIO_OTA_E2E_TESTED", "ATRIO_OTA_RELEASE_APPROVED"):
            with self.subTest(gate=gate):
                self.assertIn(gate, signer)
                self.assertIn(gate, publisher)
        self.assertIn("inputs.confirmation == 'PUBLICAR ATRIO'", publisher)
        self.assertIn("inputs.mode == 'publish'", publisher)


if __name__ == "__main__":
    unittest.main()
