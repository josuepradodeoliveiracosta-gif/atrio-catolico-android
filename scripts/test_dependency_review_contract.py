"""Contrato de Dependabot e review sem API, rede nem alteracao de dependencias."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github/workflows/dependency-review.yml"
DEPENDABOT = ROOT / ".github/dependabot.yml"


class DependencyReviewContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review = WORKFLOW.read_text(encoding="utf-8")
        cls.dependabot = DEPENDABOT.read_text(encoding="utf-8")

    def test_existing_dependabot_coverage_retained(self):
        ecosystems = re.findall(
            r'package-ecosystem:\s*"?([a-z-]+)"?', self.dependabot
        )
        self.assertEqual(set(ecosystems), {"github-actions", "gradle", "npm"})
        self.assertEqual(len(ecosystems), 3)
        self.assertIn('directory: "/tests/security"', self.dependabot)
        self.assertGreaterEqual(self.dependabot.count('interval: "weekly"'), 3)

    def test_all_prs_checked_without_path_bypass(self):
        self.assertIn("  pull_request:\n    branches: [main]", self.review)
        self.assertNotIn("paths:", self.review)
        self.assertNotIn("paths-ignore:", self.review)
        self.assertNotIn("pull_request_target", self.review)

    def test_high_severity_and_all_scopes(self):
        self.assertIn("actions/dependency-review-action@v4", self.review)
        self.assertIn("fail-on-severity: high", self.review)
        self.assertIn("fail-on-scopes: runtime, development, unknown", self.review)
        self.assertNotIn("continue-on-error: true", self.review)

    def test_no_secret_access_or_auto_deploy(self):
        self.assertIn("permissions:\n  contents: read", self.review)
        self.assertNotIn("pull-requests: write", self.review)
        self.assertNotIn("id-token: write", self.review)
        self.assertNotIn("secrets.", self.review)
        self.assertNotIn("write-all", self.review)
        self.assertNotIn("firebase deploy", self.review)
        self.assertNotIn("wrangler deploy", self.review)
        self.assertNotIn("release create", self.review)
        self.assertNotIn("cancel-in-progress: true", self.review)
        self.assertIn("vars.ATRIO_DEPENDENCY_GRAPH_READY == 'true'", self.review)
        self.assertIn("scripts/npm_audit_diff.py", self.review)
        self.assertIn("npm audit --json --package-lock-only", self.review)
        self.assertEqual(self.review.count("persist-credentials: false"), 3)


if __name__ == "__main__":
    unittest.main()
