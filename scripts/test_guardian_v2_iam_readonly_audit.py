"""Offline tests for read-only Guardião V2 IAM verification; no gcloud calls."""
import contextlib
import io
from unittest import TestCase, mock, main

from scripts import guardian_v2_iam_readonly_audit as audit


def fixture():
    return {
        "project": {"projectId": audit.PROJECT, "projectNumber": audit.NUMBER},
        "pool": {"state": "ACTIVE"},
        "provider": {"state": "ACTIVE", "oidc": {"issuerUri": "https://token.actions.githubusercontent.com"},
                     "attributeCondition": audit.CONDITION, "attributeMapping": {
                         "google.subject": "assertion.sub", "attribute.repository_id": "assertion.repository_id"}},
        "role": {"includedPermissions": sorted(audit.PERMISSIONS)},
        "account": {"email": audit.SERVICE_ACCOUNT, "disabled": False},
        "account_policy": {"bindings": [{"role": "roles/iam.workloadIdentityUser",
                                        "members": [audit.PRINCIPAL]}]},
        "project_policy": {"bindings": [{"role": audit.ROLE,
                                        "members": [f"serviceAccount:{audit.SERVICE_ACCOUNT}"]}]},
        "user_keys": [],
    }


class GuardianIamReadonlyTests(TestCase):
    def test_contract_matches_fixture(self):
        self.assertTrue(all(x == "OK" for x in audit.evaluate(fixture()).values()))

    def test_wif_drift_fails_closed(self):
        for field, value, expected in (
            ("attributeCondition", "true", "condicao_wif"),
            ("attributeMapping", {}, "mapeamento_wif"),
            ("oidc", {"issuerUri": "https://example.invalid"}, "emissor_oidc"),
        ):
            with self.subTest(field=field):
                f = fixture()
                f["provider"][field] = value
                self.assertEqual(audit.evaluate(f)[expected], "REVISAR")

    def test_extra_permissions_and_keys_are_flagged(self):
        f = fixture()
        f["role"]["includedPermissions"].append("datastore.entities.delete")
        f["user_keys"] = [{"name": "redacted"}]
        result = audit.evaluate(f)
        self.assertEqual(result["permissoes_papel"], "REVISAR")
        self.assertEqual(result["chaves_usuario_ausentes"], "REVISAR")

    def test_extra_project_role_and_unexpected_wif_member_are_flagged(self):
        f = fixture()
        f["project_policy"]["bindings"].append({"role": "roles/editor",
                                                 "members": [f"serviceAccount:{audit.SERVICE_ACCOUNT}"]})
        f["account_policy"]["bindings"].append({"role": "roles/iam.workloadIdentityUser",
                                                 "members": ["principalSet://unexpected"]})
        result = audit.evaluate(f)
        self.assertEqual(result["papeis_extras_projeto"], "REVISAR")
        self.assertEqual(result["acessos_extras_conta"], "REVISAR")

    def test_missing_data_inconclusive(self):
        f = fixture()
        del f["provider"]
        self.assertEqual(audit.evaluate(f)["condicao_wif"], "INCONCLUSIVO")

    def test_project_mismatch_stops_before_other_queries(self):
        f = fixture()
        f["project"]["projectNumber"] = "999"
        out = io.StringIO()
        with mock.patch.object(audit, "query_readonly", return_value=f["project"]) as get, \
             contextlib.redirect_stdout(out):
            self.assertEqual(audit.main(), 2)
        get.assert_called_once_with("project")
        self.assertNotIn("999", out.getvalue())

    def test_uses_only_fixed_get_describe_list_commands(self):
        for argv in audit.COMMANDS.values():
            self.assertTrue(any(x in ("describe", "get-iam-policy", "list") for x in argv), argv)
            self.assertFalse(any(x in ("apply", "set-iam-policy", "create", "delete", "update") for x in argv))

    def test_error_output_is_not_exposed(self):
        with mock.patch.object(audit.subprocess, "run", return_value=mock.Mock(
                returncode=1, stderr="SENSITIVE_FAKE_SECRET", stdout="")):
            with self.assertRaises(audit.AuditUnavailable):
                audit.query_readonly("project")

    def test_good_data_summarized_without_raw_policy(self):
        f = fixture()
        out = io.StringIO()
        with mock.patch.object(audit, "query_readonly", side_effect=lambda name: f[name]), \
             contextlib.redirect_stdout(out):
            self.assertEqual(audit.main(), 0)
        self.assertNotIn(audit.PRINCIPAL, out.getvalue())
        self.assertIn("RISCO_PENDENTE", out.getvalue())


if __name__ == "__main__":
    main()
