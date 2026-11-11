"""Contrato offline das otimizações CI sem reduzir os checks obrigatórios."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"


def workflow(filename):
    return (WORKFLOWS / filename).read_text(encoding="utf-8")


class CiOptimizationContract(unittest.TestCase):
    def test_apk_pr_reuses_required_debug_build(self):
        build = workflow("build-apk.yml")
        triggers = build.split("jobs:", 1)[0]
        self.assertIn("  push:\n    branches: [main]", triggers)
        self.assertIn("  workflow_dispatch:", triggers)
        self.assertNotIn("  pull_request:", triggers)
        self.assertIn("name: Compilar aplicativo Android", build)
        self.assertIn("gradle :app:assembleDebug", build)
        self.assertIn("ATRIO_OTA_E2E_TESTED", build)
        self.assertIn("ATRIO_OTA_RELEASE_APPROVED", build)
        self.assertIn("ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED", build)
        self.assertIn(
            "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
            build,
        )

        required = workflow("selos-ci.yml")
        self.assertIn("name: Compilar Android de testes", required)
        self.assertIn("  pull_request:\n    branches: [main]", required)
        self.assertIn(
            "gradle :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest",
            required,
        )
        self.assertIn("name: Regras de seguranca Firestore", required)
        self.assertIn("name: Detectar segredos em arquivos e histórico Git",
                      workflow("security-audit.yml"))

    def test_cancel_only_outdated_pull_requests(self):
        for name in ("selos-ci.yml", "codeql-review.yml"):
            source = workflow(name)
            self.assertIn(
                "cancel-in-progress: " + "$" +
                "{{ github.event_name == 'pull_request' }}", source,
            )
            self.assertIn("github.event.pull_request.number || github.ref", source)
        codeql = workflow("codeql-review.yml")
        self.assertIn("  schedule:", codeql)
        self.assertIn("  workflow_dispatch:", codeql)
        self.assertIn("max-parallel: 4", codeql)
        self.assertIn("languages: " + "$" + "{{ matrix.language }}", codeql)
        self.assertIn("gradle :app:assembleDebug", codeql)

    def test_reporting_has_one_completed_source_and_no_merge_permission(self):
        source = workflow("ci-quality-report.yml")
        on_block = source.split("on:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertIn("workflow_run:", on_block)
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("pull_request:", on_block)
        self.assertEqual(on_block.count("      - Revisão automática - CodeQL"), 1)
        self.assertNotIn("      - Gerar APK do Atrio Catolico", on_block)
        self.assertNotIn("      - Validar selos", on_block)
        self.assertIn("types: [completed]", on_block)
        self.assertIn("workflow_run.conclusion != 'cancelled'", source)
        self.assertIn("contents: read", source)
        self.assertNotIn("contents: write", source)
        self.assertNotIn("pull-requests: write", source)

    def test_guardian_no_pr_trigger_and_limited_cron(self):
        source = workflow("guardiao-v2-prod-runner.yml")
        on_block = source.split("on:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertIn("cron: '17 */2 * * *'", on_block)
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("pull_request:", on_block)
        self.assertIn("GUARDIAN_V2_SHADOW_ONLY: 'true'", source)
        self.assertIn("GUARDIAN_V2_HOLD_ENABLED: 'false'", source)
        self.assertIn("GUARDIAN_V2_WRITE_ENABLED: 'false'", source)
        self.assertNotIn("wrangler deploy", source)
        self.assertNotIn("firebase deploy", source)

    def test_existing_safe_caches_kept(self):
        selos = workflow("selos-ci.yml")
        self.assertIn("cache: npm", selos)
        self.assertIn("cache-dependency-path: tests/security/package-lock.json", selos)
        self.assertIn("gradle/actions/setup-gradle@v4", selos)
        self.assertIn("gradle/actions/setup-gradle@v4", workflow("build-apk.yml"))
        self.assertIn("gradle/actions/setup-gradle@", workflow("codeql-review.yml"))


if __name__ == "__main__":
    unittest.main()
