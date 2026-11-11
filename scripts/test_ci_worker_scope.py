"""Testes offline da selecao fail-closed de bundles Workers."""
import subprocess
import unittest
from types import SimpleNamespace
from scripts.ci_worker_scope import BOTH, choose_bundles, changed_paths

BASE = "a" * 40
HEAD = "b" * 40
MERGE = "c" * 40


class WorkerScopeTests(unittest.TestCase):
    def test_avatar_and_push_isolated(self):
        self.assertEqual(choose_bundles(["cloudflare/avatar-worker/src/index.js"]), (True, False))
        self.assertEqual(choose_bundles(["cloudflare/push-worker/src/index.js"]), (False, True))
        self.assertEqual(choose_bundles([
            "docs/intro.md", "cloudflare/push-worker/src/index.test.js"
        ]), (False, True))
        self.assertEqual(choose_bundles([
            "cloudflare/avatar-worker/src/index.js",
            "cloudflare/push-worker/schema.sql",
        ]), BOTH)

    def test_shared_or_unknown_cloudflare_fail_closed(self):
        for name in (
            "cloudflare/email-verification-policy.mjs",
            "cloudflare/worker-email-gate.test.mjs",
            "cloudflare/guardian-worker/src/index.js",
            "cloudflare/shared/common.js",
            ".github/workflows/worker-bundle-dry-run-ci.yml",
            "scripts/ci_worker_scope.py",
            "scripts/test_ci_worker_scope.py",
        ):
            with self.subTest(name=name):
                self.assertEqual(choose_bundles([name]), BOTH)

    def test_malformed_and_empty_fail_closed(self):
        for value in ([], None, ["docs/file.md"], ["../cloudflare/push-worker/a"],
                      ["/cloudflare/push-worker/a"], ["cloudflare//push-worker/a"],
                      ["cloudflare/push-worker/a\\nflag=true"],
                      [12], ["cloudflare/push-worker/x" * 300],
                      ["cloudflare/push-worker/test"] * 5001):
            with self.subTest(value=str(value)[:40]):
                self.assertEqual(choose_bundles(value), BOTH)

    def test_verified_merge_base_and_zero_delimited_diff(self):
        calls = []
        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[1] == "merge-base":
                return SimpleNamespace(stdout=(MERGE + "\\n").encode())
            return SimpleNamespace(stdout=b"cloudflare/push-worker/src/a.js\\0")
        result = changed_paths(BASE, HEAD, runner=runner)
        self.assertEqual(result, ["cloudflare/push-worker/src/a.js"])
        self.assertEqual(calls[0], ["git", "merge-base", "--all", BASE, HEAD])
        self.assertIn("--no-renames", calls[1])
        self.assertEqual(calls[1][-3:], [MERGE, HEAD, "--"])

    def test_ambiguous_diff_or_invalid_sha(self):
        def runner(argv, **kwargs):
            return SimpleNamespace(stdout=(MERGE + "\\n" + MERGE + "\\n").encode())
        with self.assertRaises(ValueError):
            changed_paths(BASE, HEAD, runner=runner)
        with self.assertRaises(ValueError):
            changed_paths("main", HEAD, runner=runner)

        def missing(argv, **kwargs):
            if argv[1] == "merge-base":
                return SimpleNamespace(stdout=(MERGE + "\\n").encode())
            return SimpleNamespace(stdout=b"cloudflare/avatar-worker/a")
        with self.assertRaises(ValueError):
            changed_paths(BASE, HEAD, runner=missing)


if __name__ == "__main__":
    unittest.main()
