"""Exercita o seletor de bundles usando Git real, mas somente em tempdirs."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import ci_worker_scope as scope


class WorkerScopeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="atrio-ci-scope-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "CI Offline")
        self.git("config", "user.email", "ci@example.invalid")
        self.write("README.md", "only doc\n")
        self.write("cloudflare/avatar-worker/src/index.js", "// avatar\n")
        self.write("cloudflare/push-worker/src/index.js", "// push\n")
        self.write("cloudflare/email-verification-policy.mjs", "// shared\n")
        self.git("add", "-A")
        self.git("commit", "-qm", "baseline")
        self.base = self.git("rev-parse", "HEAD").stdout.decode().strip()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.root, capture_output=True,
            check=True, timeout=30,
        )

    def write(self, name, data):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(data, encoding="utf-8")

    def classify_after_commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "change")
        head = self.git("rev-parse", "HEAD").stdout.decode().strip()
        with patch.object(scope, "ROOT", self.root):
            paths = scope.changed_paths(self.base, head)
        return paths, scope.choose_bundles(paths)

    def test_avatar_only_with_unrelated_document(self):
        self.write("cloudflare/avatar-worker/src/index.js", "// new avatar\n")
        self.write("docs/scope.md", "docs are unrelated\n")
        paths, selection = self.classify_after_commit()
        self.assertIn("cloudflare/avatar-worker/src/index.js", paths)
        self.assertEqual(selection, (True, False))

    def test_push_only(self):
        self.write("cloudflare/push-worker/src/index.js", "// new push\n")
        paths, selection = self.classify_after_commit()
        self.assertEqual(paths, ["cloudflare/push-worker/src/index.js"])
        self.assertEqual(selection, (False, True))

    def test_shared_policy_forces_both(self):
        self.write("cloudflare/email-verification-policy.mjs", "// new shared\n")
        _, selection = self.classify_after_commit()
        self.assertEqual(selection, scope.BOTH)

    def test_deletion_of_avatar_selects_avatar(self):
        (self.root / "cloudflare/avatar-worker/src/index.js").unlink()
        paths, selection = self.classify_after_commit()
        self.assertEqual(paths, ["cloudflare/avatar-worker/src/index.js"])
        self.assertEqual(selection, (True, False))

    def test_rename_between_workers_checks_both(self):
        old = self.root / "cloudflare/avatar-worker/src/index.js"
        new = self.root / "cloudflare/push-worker/src/moved.js"
        old.rename(new)
        paths, selection = self.classify_after_commit()
        self.assertIn("cloudflare/avatar-worker/src/index.js", paths)
        self.assertIn("cloudflare/push-worker/src/moved.js", paths)
        self.assertEqual(selection, scope.BOTH)

    def test_renaming_shared_policy_forces_both(self):
        old = self.root / "cloudflare/email-verification-policy.mjs"
        old.rename(self.root / "cloudflare/new-shared-policy.mjs")
        _, selection = self.classify_after_commit()
        self.assertEqual(selection, scope.BOTH)

    def test_docs_only_falls_back_to_both(self):
        self.write("docs/next.md", "no worker paths\n")
        _, selection = self.classify_after_commit()
        self.assertEqual(selection, scope.BOTH)


if __name__ == "__main__":
    unittest.main()
