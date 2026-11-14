"""Offline negative tests for the Guardian V2 identity-separation preflight."""
from unittest import TestCase, main
from unittest.mock import patch
import contextlib
import io

from scripts import guardian_v2_isolation_preflight as audit


def source():
    return audit.WORKFLOW.read_text(encoding="utf-8")


def manual_only(text, before, after):
    first, separator, manual = text.partition("\n  activate-policy:\n")
    if not separator or manual.count(before) != 1:
        raise AssertionError("Unexpected workflow source fixture")
    return first + separator + manual.replace(before, after)


class IsolationPreflightTests(TestCase):
    def test_current_workflow_is_not_misrepresented_as_isolated(self):
        result = audit.assess(source())
        self.assertEqual(result, {
            "conta_servico": "COMPARTILHADO",
            "provedor_wif": "COMPARTILHADO",
            "ambiente": "COMPARTILHADO",
            "firestore_iam": "NAO_ATestado",
            "decisao": "NO_GO",
        })

    def test_distinct_service_account_alone_is_still_no_go(self):
        modified = manual_only(
            source(), "service_account: guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com",
            "service_account: guardian-v2-activator@atrio-catolico.iam.gserviceaccount.com")
        result = audit.assess(modified)
        self.assertEqual(result["conta_servico"], "DISTINTO_NO_CODIGO")
        self.assertEqual(result["provedor_wif"], "COMPARTILHADO")
        self.assertEqual(result["decisao"], "NO_GO")

    def test_distinct_provider_alone_is_still_no_go(self):
        modified = manual_only(
            source(), "workloadIdentityPools/guardian-v2-writer/providers/github-moderator",
            "workloadIdentityPools/guardian-v2-activator/providers/github-policy")
        result = audit.assess(modified)
        self.assertEqual(result["provedor_wif"], "DISTINTO_NO_CODIGO")
        self.assertEqual(result["conta_servico"], "COMPARTILHADO")
        self.assertEqual(result["decisao"], "NO_GO")

    def test_distinct_environment_alone_is_still_no_go(self):
        modified = manual_only(source(), "environment: guardian-v2-production-moderation",
                               "environment: guardian-v2-policy-activation")
        result = audit.assess(modified)
        self.assertEqual(result["ambiente"], "DISTINTO_NO_CODIGO")
        self.assertEqual(result["conta_servico"], "COMPARTILHADO")
        self.assertEqual(result["decisao"], "NO_GO")

    def test_three_distinct_names_still_require_external_iam_proof(self):
        modified = manual_only(
            source(), "service_account: guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com",
            "service_account: guardian-v2-activator@atrio-catolico.iam.gserviceaccount.com")
        modified = manual_only(
            modified, "workloadIdentityPools/guardian-v2-writer/providers/github-moderator",
            "workloadIdentityPools/guardian-v2-activator/providers/github-policy")
        modified = manual_only(
            modified, "environment: guardian-v2-production-moderation",
            "environment: guardian-v2-policy-activation")
        result = audit.assess(modified)
        self.assertTrue(all(result[key] == "DISTINTO_NO_CODIGO"
                            for key in audit.RESULT_NAMES))
        self.assertEqual(result["firestore_iam"], "NAO_ATestado")
        self.assertEqual(result["decisao"], "EXIGE_PROVA_QA_IAM")

    def test_missing_or_duplicate_identity_is_inconclusive_and_no_go(self):
        original = source()
        cases = (
            original.replace("service_account: guardian-v2-writer@", "missing_account: guardian-v2-writer@", 1),
            original.replace("  moderator:\n", "  other-job:\n", 1),
            original.replace("  activate-policy:\n", "  unknown-job:\n", 1),
            original.replace("  activate-policy:\n", "  activate-policy:\n  activate-policy:\n", 1),
            original + "\n          service_account: duplicate@invalid.example\n",
        )
        for changed in cases:
            with self.subTest(size=len(changed)):
                self.assertEqual(audit.assess(changed)["decisao"], "NO_GO")

    def test_wrong_branch_or_manual_event_must_not_count_as_separated(self):
        original = source()
        for changed in (
            original.replace("github.ref == 'refs/heads/main'", "github.ref == 'refs/heads/dev'", 1),
            original.replace("github.event_name == 'workflow_dispatch'",
                             "github.event_name == 'pull_request'"),
            original.replace("inputs.confirm_policy_activation == true",
                             "inputs.confirm_policy_activation != true"),
        ):
            self.assertEqual(audit.assess(changed)["decisao"], "NO_GO")

    def test_cli_no_go_is_nonzero_and_does_not_print_identities(self):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), patch.object(audit, "WORKFLOW",
                                                                audit.WORKFLOW):
            self.assertEqual(audit.main(), 2)
        output = stream.getvalue()
        self.assertIn("decisao: NO_GO", output)
        self.assertNotIn("iam.gserviceaccount.com", output)
        self.assertNotIn("workloadIdentityPools/", output)
        self.assertNotIn("access_token", output)

    def test_empty_source_is_never_authorized(self):
        result = audit.assess("")
        self.assertEqual(result["decisao"], "NO_GO")
        self.assertTrue(all(result[k] == "INCONCLUSIVO" for k in audit.RESULT_NAMES))


if __name__ == "__main__":
    main()
