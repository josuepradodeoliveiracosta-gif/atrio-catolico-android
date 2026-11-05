#!/usr/bin/env python3
"""Offline regression cases for the safe documentation-only CI classifier."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from ci_documentation_scope import requires_full_ci

SCRIPT = Path(__file__).with_name("ci_documentation_scope.py")


def diff(*entries):
    """Build a representative git diff --raw -z pair stream."""
    fragments = []
    for status, path in entries:
        oldmode = "000000" if status == "A" else "100644"
        oldsha = "0" * 40 if status == "A" else "1" * 40
        meta = f":{oldmode} 100644 {oldsha} {'2' * 40} {status}"
        fragments.append(meta.encode() + b"\0" + path.encode() + b"\0")
    return b"".join(fragments)


def full(data, **kwargs):
    return requires_full_ci(data, event="pull_request",
                            comparison_verified=True, **kwargs)


class ScopeTests(unittest.TestCase):
    def test_documentation_only_is_candidate_to_skip(self):
        for rows in (
            [("M", "README.md")],
            [("A", "docs/INDEX.md")],
            [("M", "design/selos-e-titulos/README.md")],
            [("A", ".github/ISSUE_TEMPLATE/proposta-design.md")],
            [("M", "README.md"), ("A", "docs/a/b/c.md")],
        ):
            with self.subTest(rows=rows):
                self.assertFalse(full(diff(*rows)))

    def test_code_security_and_mixed_changes_must_run_full_ci(self):
        for path in (
            "app/src/main/java/br/com/atriocatolico/MainActivity.kt",
            "app/src/androidTest/java/br/com/atriocatolico/GuardianV2UiTest.kt",
            "app/build.gradle.kts", "build.gradle.kts", "settings.gradle.kts",
            "firestore.rules", "firestore.indexes.json", "firebase.json",
            "cloudflare/guardian-worker/src/index.js",
            "cloudflare/avatar-worker/src/index.js",
            "cloudflare/push-worker/src/index.js",
            "cloudflare/account-deletion-processor/src/controlled-executor.js",
            "tests/security/guardian-v2.test.mjs",
            "scripts/validar_firebase.py", "scripts/ci_documentation_scope.py",
            "scripts/test_ci_documentation_scope.py",
            "scripts/ota_release.py", ".github/workflows/selos-ci.yml",
            "README_ASSINATURA_PERMANENTE.md", "SECURITY.md", "CHANGELOG.md",
            "docs/data.json", "design/logo.png", ".github/ISSUE_TEMPLATE/config.yml",
        ):
            with self.subTest(path=path):
                self.assertTrue(full(diff(("M", path))))
                self.assertTrue(full(diff(("M", "docs/INDEX.md"), ("A", path))))

    def test_non_pr_or_unverified_diff_is_not_exempt(self):
        for event in ("push", "schedule", "workflow_dispatch", "unknown", ""):
            with self.subTest(event=event):
                self.assertTrue(requires_full_ci(diff(("M", "README.md")),
                                                 event=event, comparison_verified=True))
        self.assertTrue(requires_full_ci(diff(("M", "README.md")),
                                         event="pull_request"))

    def test_invalid_diff_or_versions_are_not_exempt(self):
        invalid = [
            None, b"", b":100644 100644 1234567 1234568 M\0docs/x.md",
            b":100644 100644 1234567 1234568 M\0",
            b":100644 100644 1234567 1234568 M\0docs/x.md\0tail\0",
            diff(("M", "docs/x.md"))[:-1],
            diff(("M", "docs/x.md"), ("M", "docs/x.md")),
            diff(*([("M", "docs/x.md")] * 1001)),
            diff(("M", "docs/x.md")) + b"a" * 262145,
            b":100644 100644 1234567 1234568 M\0docs/\xff.md\0",
        ]
        for data in invalid:
            with self.subTest(value=str(data)[:64]):
                self.assertTrue(full(data))
        for status in ("D", "T", "U", "X", "B", "R100", "C100", "M100"):
            with self.subTest(status=status):
                self.assertTrue(full(diff((status, "docs/x.md"))))

    def test_symlink_executable_and_uncommitted_modes_fail_closed(self):
        valid = diff(("A", "docs/new.md"))
        self.assertFalse(full(valid))
        for oldmode, newmode, oldsha, newsha, status in (
            ("000000", "120000", "0" * 40, "2" * 40, "A"),
            ("000000", "100755", "0" * 40, "2" * 40, "A"),
            ("100644", "120000", "1" * 40, "2" * 40, "M"),
            ("100755", "100644", "1" * 40, "2" * 40, "M"),
            ("100644", "100644", "1" * 40, "0" * 40, "M"),
            ("000000", "100644", "1" * 40, "2" * 40, "A"),
        ):
            with self.subTest(oldmode=oldmode, newmode=newmode, status=status):
                meta = f":{oldmode} {newmode} {oldsha} {newsha} {status}"
                self.assertTrue(full(meta.encode() + b"\0docs/new.md\0"))

    def test_unsafe_or_ambiguous_paths_are_not_exempt(self):
        for path in (
            "docs/../app/build.gradle.kts", "docs/./INDEX.md", "docs//INDEX.md",
            "docs/", "/docs/x.md", r"docs\a.md", "docs/../safe.md",
            "docs/a\nheavy=false.md", "docs/file\t.md", "docs/a\r.md",
            "docs/\u202eabc.md", "docs/secret.md ", " docs/x.md",
            "docs/x.MD", "design/logo.svg", "docs/a.md/other.md",
            "docs/" + "x" * 1100 + ".md",
        ):
            with self.subTest(path=path):
                self.assertTrue(full(diff(("M", path))))

    def test_real_git_raw_diff_including_new_markdown_and_symlink(self):
        # Make sure the parser understands git's actual -z format, not only
        # synthetic raw records. This fixture has no outside credentials.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.run(["git", "-C", str(root), *args],
                                      capture_output=True, check=True).stdout
            git("init", "-q")
            git("-c", "user.name=Fixture", "-c", "user.email=qa@example.invalid",
                "commit", "--allow-empty", "-qm", "start")
            (root / "docs").mkdir()
            (root / "docs" / "guide.md").write_text("hello\n")
            git("add", "docs/guide.md")
            git("-c", "user.name=Fixture", "-c", "user.email=qa@example.invalid",
                "commit", "-qm", "first doc")
            (root / "docs" / "guide.md").write_text("updated\n")
            (root / "docs" / "another.md").write_text("new\n")
            git("add", "-A")
            raw = git("diff", "--cached", "--raw", "-z")
            self.assertFalse(full(raw))
            (root / "docs" / "linked.md").symlink_to("guide.md")
            git("add", "docs/linked.md")
            self.assertTrue(full(git("diff", "--cached", "--raw", "-z")))

    def test_cli_defaults_to_heavy_and_only_reports_scoped_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "diff.bin"
            path.write_bytes(diff(("M", "docs/INDEX.md")))
            def cli(*args):
                return subprocess.run([sys.executable, str(SCRIPT),
                                       "--raw-diff-z", str(path), *args],
                                      text=True, capture_output=True, check=True).stdout.strip()
            self.assertEqual(cli("--event", "pull_request"), "heavy=true")
            self.assertEqual(cli("--event", "push", "--comparison-verified"), "heavy=true")
            self.assertEqual(cli("--event", "pull_request", "--comparison-verified"),
                             "heavy=false")
            path.write_bytes(diff(("M", "firestore.rules")))
            self.assertEqual(cli("--event", "pull_request", "--comparison-verified"),
                             "heavy=true")
            path.unlink()
            self.assertEqual(cli("--event", "pull_request", "--comparison-verified"),
                             "heavy=true")


if __name__ == "__main__":
    unittest.main()
