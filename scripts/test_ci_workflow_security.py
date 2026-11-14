#!/usr/bin/env python3
"""Offline regression tests for the mandatory workflow permission guard."""
from pathlib import Path
import tempfile
import unittest

from scripts.ci_workflow_security import (
    PROTECTOR, ROOT, TRUSTED_REF, audit_sources, audit_workflows, protected_workflow_issues,
)


PROTECTOR_YAML = (
    "name: Trava de exclusoes\n"
    "on:\n"
    "  pull_request_target:\n"
    "    types: [opened, synchronize, reopened, ready_for_review, edited]\n"
    "    branches: [main]\n"
    "permissions:\n"
    "  contents: read\n"
    "jobs:\n"
    "  bloquear-exclusoes:\n"
    "    steps:\n"
    "      - uses: actions/checkout@v4\n"
    "        with:\n"
    "          " + TRUSTED_REF + "\n"
    "          persist-credentials: false\n"
    "      - run: |\n"
    "          [[ \"$(git rev-parse HEAD)\" == \"$PR_BASE_SHA\" ]]\n"
    "          git fetch --no-tags --force origin refs/pull/123/head\n"
    "          test \"$(git rev-parse FETCH_HEAD)\" = \"$PR_HEAD_SHA\"\n"
    "          BASE_COMUM=\"$(git merge-base \"$PR_BASE_SHA\" \"$PR_HEAD_SHA\")\"\n"
    "          python3 scripts/guard_exclusoes.py --base \"$BASE_COMUM\"\n"
)


class WorkflowSecurityTests(unittest.TestCase):
    def setUp(self):
        # Fixture exclusivamente em memoria: nenhuma referencia a credencial
        # ficticia e escrita em disco durante os testes de seguranca.
        self.sources = {
            PROTECTOR: PROTECTOR_YAML,
            "ordinary.yml": "name: comum\non:\n  pull_request:\npermissions:\n  contents: read\n",
        }

    def write(self, filename, content):
        self.sources[filename] = content

    def assert_blocked(self, expected):
        errors = audit_sources(self.sources)
        self.assertTrue(any(expected in e for e in errors), errors)

    def test_current_repository_policy_passes(self):
        self.assertEqual(audit_workflows(ROOT / ".github" / "workflows"), [])

    def test_valid_protection_and_regular_pr_pass(self):
        self.assertEqual(audit_sources(self.sources), [])

    def test_reject_unapproved_pull_request_target(self):
        self.write("unsafe.yml", "on:\n  pull_request_target:\npermissions:\n  contents: read\n")
        self.assert_blocked("pull_request_target nao autorizado")

    def test_reject_quoted_and_inline_target(self):
        self.write("unsafe.yaml", "on:\n  'pull_request_target':\n")
        self.assert_blocked("pull_request_target nao autorizado")
        self.write("unsafe.yaml", "on: [pull_request_target]\n")
        self.assert_blocked("inline nao autorizado")
        self.write("unsafe.yaml", "on: {pull_request_target: {}}\n")
        self.assert_blocked("inline nao autorizado")

    def test_reject_all_syntaxes_of_write_all(self):
        for text in (
            "permissions: write-all\n",
            "permissions: 'write-all' # comentario\n",
            "  permissions: \"write-all\"\n",
            "'permissions': write-all\n",
        ):
            with self.subTest(line=text):
                self.write("unsafe.yml", text)
                self.assert_blocked("permissions write-all")

    def test_comments_do_not_create_false_positives(self):
        self.write("ordinary.yml",
                   "name: comum\n# permissions: write-all\n# pull_request_target:\n"
                   "on:\n  pull_request:\npermissions:\n  contents: read\n")
        self.assertEqual(audit_sources(self.sources), [])

    def test_reject_removed_or_duplicated_protected_trigger(self):
        del self.sources[PROTECTOR]
        self.assert_blocked("workflow de protecao obrigatorio ausente")
        self.write(PROTECTOR, PROTECTOR_YAML.replace(
            "  pull_request_target:\n", "  pull_request:\n"))
        self.assert_blocked("esperado exatamente um gatilho")
        self.write(PROTECTOR, PROTECTOR_YAML.replace(
            "  pull_request_target:\n",
            "  pull_request_target:\n  pull_request_target:\n"))
        self.assert_blocked("esperado exatamente um gatilho")

    def test_reject_protected_checkout_of_untrusted_head(self):
        self.write(PROTECTOR, PROTECTOR_YAML.replace("base.sha", "head.sha"))
        self.assert_blocked("invariante confiavel")
        self.assert_blocked("checkout da branch/commit nao confiavel")

    def test_reject_spoofed_base_ref_in_comment(self):
        spoofed = PROTECTOR_YAML.replace(
            TRUSTED_REF, "ref: refs/heads/untrusted\n          # " + TRUSTED_REF,
        )
        self.write(PROTECTOR, spoofed)
        self.assert_blocked("checkout deve usar exclusivamente o SHA da base confiavel")

    def test_reject_missing_head_base_comparison(self):
        self.write(PROTECTOR, PROTECTOR_YAML.replace(
            '[[ "$(git rev-parse HEAD)" == "$PR_BASE_SHA" ]]', "echo bypass",
        ))
        self.assert_blocked("validar HEAD contra o SHA da base")

    def test_reject_write_permission_or_secrets_in_protector(self):
        self.write(PROTECTOR, PROTECTOR_YAML.replace("  contents: read", "  contents: write"))
        self.assert_blocked("permissao de escrita")
        # Exercita o detector de credenciais em memoria, sem gravacao em disco.
        secret_source = PROTECTOR_YAML + "\n    env:\n      KEY: " + "secrets." + "EXAMPLE\n"
        self.assertTrue(
            any("credenciais ou OIDC" in error
                for error in protected_workflow_issues(secret_source))
        )
        self.write(PROTECTOR, PROTECTOR_YAML + "\n      id-token: write\n")
        self.assert_blocked("credenciais ou OIDC")

    def test_reject_missing_guard_or_second_checkout(self):
        self.write(PROTECTOR, PROTECTOR_YAML.replace(
            "python3 scripts/guard_exclusoes.py", "echo skipped"))
        self.assert_blocked("invariante confiavel")
        self.write(PROTECTOR, PROTECTOR_YAML + "\n      - uses: actions/checkout@v4\n")
        self.assert_blocked("unico checkout")

    def test_reject_missing_or_empty_directory(self):
        with tempfile.TemporaryDirectory() as empty:
            self.assertTrue(audit_workflows(Path(empty)))
            self.assertTrue(audit_workflows(Path(empty) / "missing"))

    def test_security_workflow_is_wired_to_fail_closed_guard(self):
        content = (ROOT / ".github/workflows/security-audit.yml").read_text(encoding="utf-8")
        self.assertIn("python3 scripts/ci_workflow_security.py", content)
        self.assertIn("python3 -m unittest scripts.test_ci_workflow_security -v", content)
        self.assertNotIn("! grep -RInE", content)
        self.assertIn("scripts/check_public_secrets.py --history", content)


if __name__ == "__main__":
    unittest.main()
