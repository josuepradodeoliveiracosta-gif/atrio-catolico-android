"""Contrato offline de segurança do workflow CodeQL."""
import re
import unittest
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / ".github/workflows/codeql-review.yml"


class CodeqlReviewContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FILE.read_text(encoding="utf-8")

    def test_all_prs_and_main_checked(self):
        self.assertIn("  pull_request:\n    branches: [main]", self.source)
        self.assertIn("  push:\n    branches: [main]", self.source)
        self.assertIn("  schedule:\n", self.source)
        self.assertIn("  workflow_dispatch:", self.source)
        self.assertNotIn("pull_request_target", self.source)
        self.assertNotIn("paths-ignore:", self.source)

    def test_languages(self):
        pairs = re.findall(
            r"^\s{10}- language: ([a-z-]+)\n\s{12}build-mode: ([a-z]+)$",
            self.source, flags=re.MULTILINE,
        )
        self.assertEqual(dict(pairs), {
            "javascript-typescript": "none",
            "python": "none",
            "actions": "none",
            "java-kotlin": "manual",
        })
        self.assertIn("fail-fast: false", self.source)

    def test_no_secrets_or_excess_permissions(self):
        self.assertIn("permissions:\n  contents: read", self.source)
        self.assertIn(
            "    permissions:\n      actions: read\n"
            "      contents: read\n      security-events: write",
            self.source,
        )
        self.assertNotIn("secrets.", self.source)
        self.assertNotIn("id-token: write", self.source)
        self.assertNotIn("write-all", self.source)
        self.assertEqual(self.source.count("persist-credentials: false"), 2)

    def test_java_kotlin_debug_only(self):
        self.assertIn("gradle :app:assembleDebug --no-daemon --stacktrace",
                      self.source)
        self.assertIn("python3 scripts/validar_firebase.py", self.source)
        self.assertIn("ATRIO_SIGNING_STORE_PASSWORD: ''", self.source)
        self.assertNotRegex(
            self.source,
            r"\b(?:assembleRelease|publishRelease|firebase deploy|"
            r"wrangler deploy|gh release create)\b",
        )

    def test_codeql_quality_and_only_pr_cancel(self):
        self.assertIn("github/codeql-action/init@v4", self.source)
        self.assertIn("github/codeql-action/analyze@v4", self.source)
        self.assertIn("android-actions/setup-android@be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd", self.source)
        self.assertIn("gradle/actions/setup-gradle@ed408507eac070d1f99cc633dbcf757c94c7933a", self.source)
        self.assertNotIn("android-actions/setup-android@v4", self.source)
        self.assertNotIn("gradle/actions/setup-gradle@v4", self.source)
        self.assertIn("queries: security-and-quality", self.source)
        self.assertIn("category: /language:${{ matrix.language }}", self.source)
        self.assertIn(
            "cancel-in-progress: " + "$" + "{{ github.event_name == 'pull_request' }}",
            self.source,
        )
        self.assertNotIn("cancel-in-progress: true", self.source)


if __name__ == "__main__":
    unittest.main()
