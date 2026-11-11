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
        self.assertIn(
            "group: atrio-selos-" + "$" + "{{ github.event_name == 'pull_request' && "
            "format('pr-{0}', github.event.pull_request.number) || "
            "format('run-{0}', github.run_id) }}",
            workflow("selos-ci.yml"),
        )
        codeql = workflow("codeql-review.yml")
        # PRs compartilham apenas o mesmo grupo; os demais eventos usam run_id
        # para preservar execucoes pendentes, alem das em andamento.
        self.assertIn(
            "group: atrio-codeql-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
            codeql,
        )
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

    def test_optional_worker_selection_and_safe_queues(self):
        worker = workflow("worker-bundle-dry-run-ci.yml")
        self.assertIn("scripts/ci_worker_scope.py", worker)
        self.assertIn("scripts/test_ci_worker_scope.py", worker)
        self.assertIn("fetch-depth: 0", worker)
        self.assertIn("steps.scope.outputs.avatar == 'true'", worker)
        self.assertIn("steps.scope.outputs.push == 'true'", worker)
        self.assertIn("CLOUDFLARE_API_TOKEN: ''", worker)
        self.assertIn("--dry-run", worker)
        self.assertNotIn("secrets.", worker)
        for filename in (
            "worker-bundle-dry-run-ci.yml",
            "guardiao-v2-motor-ci.yml",
            "guardiao-v2-fluxo-emulador-ci.yml",
        ):
            source = workflow(filename)
            self.assertIn("format('pr-{0}', github.event.pull_request.number)", source)
            self.assertIn("format('run-{0}', github.run_id)", source)
            self.assertIn(
                "cancel-in-progress: " + "$" +
                "{{ github.event_name == 'pull_request' }}", source,
            )
        apk = workflow("build-apk.yml")
        self.assertIn("group: apk-run-" + "$" + "{{ github.run_id }}", apk)
        self.assertIn("cancel-in-progress: false", apk)
        self.assertIn("  workflow_dispatch:", apk)
        scope = workflow("pr-scope-report.yml")
        self.assertIn("group: atrio-pr-scope-" + "$" +
                      "{{ github.event.pull_request.number }}", scope)
        self.assertIn("cancel-in-progress: true", scope)

    def test_timing_monitor_is_read_only(self):
        report = workflow("ci-quality-report.yml")
        self.assertIn("actions: read", report)
        self.assertIn("checks: read", report)
        self.assertIn("scripts/ci_quality_report.py", report)
        self.assertNotIn("pull-requests: write", report)
        required = workflow("selos-ci.yml")
        self.assertIn("scripts.test_ci_quality_report", required)


    def test_existing_safe_caches_kept(self):
        selos = workflow("selos-ci.yml")
        self.assertIn("cache: npm", selos)
        self.assertIn("cache-dependency-path: tests/security/package-lock.json", selos)
        self.assertIn("gradle/actions/setup-gradle@v4", selos)
        self.assertIn("gradle/actions/setup-gradle@v4", workflow("build-apk.yml"))
        self.assertIn("gradle/actions/setup-gradle@", workflow("codeql-review.yml"))


if __name__ == "__main__":
    unittest.main()
