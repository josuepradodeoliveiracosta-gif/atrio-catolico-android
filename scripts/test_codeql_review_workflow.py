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

    def test_parallel_contract_and_required_firestore_gate(self):
        source = self.source
        self.assertIn("  contract:\n", source)
        codeql_job = source.split("  codeql:\n", 1)[1]
        self.assertNotIn("    needs: contract\n", codeql_job)
        self.assertIn("    strategy:\n      fail-fast: false\n      max-parallel: 4", codeql_job)
        self.assertIn("      security-events: write", codeql_job)
        self.assertIn("scripts/test_codeql_review_workflow.py -v", source)

        # A eliminacao da dependência nao pode tirar a validacao de
        # segurança dos checks obrigatorios na PR.
        mandatory = (
            FILE.parent / "selos-ci.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("name: Regras de seguranca Firestore", mandatory)
        self.assertIn("scripts.test_codeql_review_workflow", mandatory)

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

    def test_actions_node24_pilot_preserves_matrix_and_kotlin_coverage(self):
        source = self.source
        self.assertEqual(source.count("uses: actions/checkout@v7"), 2)
        self.assertNotIn("uses: actions/checkout@v4", source)
        self.assertIn("uses: actions/setup-java@v6", source)
        self.assertNotIn("uses: actions/setup-java@v4", source)
        self.assertEqual(
            source.count(
                "uses: gradle/actions/setup-gradle@"
                "0723195856401067f7a2779048b490ace7a47d7c"
            ), 1,
        )
        self.assertNotIn("gradle/actions/setup-gradle@v6", source)
        self.assertNotIn("cache-provider: enhanced", source)
        self.assertNotIn("cache-disabled: true", source)
        self.assertIn("gradle-version: '8.13'", source)
        self.assertIn("java-version: '17'", source)
        self.assertIn("if: matrix.language == 'java-kotlin'", source)
        self.assertIn("build-mode: manual", source)
        self.assertIn("gradle :app:assembleDebug --no-daemon --stacktrace", source)
        self.assertIn("languages: " + "$" + "{{ matrix.language }}", source)
        self.assertIn("queries: security-and-quality", source)
        self.assertIn("max-parallel: 4", source)
        self.assertNotIn("pull_request_target", source)
        self.assertNotIn("id-token: write", source)
        self.assertNotIn("assembleRelease", source)

    def test_codeql_quality_and_only_pr_cancel(self):
        self.assertIn("github/codeql-action/init@v4", self.source)
        self.assertIn("github/codeql-action/analyze@v4", self.source)
        self.assertIn("android-actions/setup-android@be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd", self.source)
        self.assertIn("gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c", self.source)
        self.assertNotIn("android-actions/setup-android@v4", self.source)
        self.assertNotIn("gradle/actions/setup-gradle@v4", self.source)
        self.assertIn("queries: security-and-quality", self.source)
        self.assertIn("category: /language:${{ matrix.language }}", self.source)
        self.assertIn(
            "cancel-in-progress: " + "$" + "{{ github.event_name == 'pull_request' }}",
            self.source,
        )
        self.assertIn(
            "group: atrio-codeql-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
            self.source,
        )
        self.assertNotIn("group: atrio-codeql-${{ github.ref }}", self.source)
        self.assertNotIn("cancel-in-progress: true", self.source)


if __name__ == "__main__":
    unittest.main()
