"""Offline tests: QA evidence completeness is NOT proof of real IAM isolation."""
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest

from scripts import guardian_v2_qa_evidence_gate as gate


def valid_report():
    cases = []
    for index, (scenario, (actor, outcome, effect)) in enumerate(gate.SCENARIOS.items()):
        cases.append({
            "scenario": scenario,
            "principal": actor,
            "authenticated": True,
            "http_status": 200 if outcome == "ALLOW" else 403,
            "pre_post_checked": True,
            "effects_present": effect,
            "evidence_ref": f"QA-case-{index:03d}",
        })
    return {
        "qa_project": "atrio-catolico-qa",
        "qa_isolated_confirmed": True,
        "qa_iam_reviewed": True,
        "qa_costs_authorized": True,
        "evidence_origin": "authenticated_external_qa",
        "cases": cases,
    }


def decision(value):
    return gate.assess(value)["decision"]


class EvidenceGateTests(unittest.TestCase):
    def test_complete_report_is_only_candidate_for_human_review(self):
        summary = gate.assess(valid_report())
        self.assertEqual(summary["decision"], "CANDIDATO_REVISAO_HUMANA")
        self.assertEqual(summary["conformes"], len(gate.SCENARIOS))
        self.assertEqual(summary["exigidos"], len(gate.SCENARIOS))
        self.assertNotIn("production_authorized", summary)

    def test_absent_and_malformed_reports_are_no_go(self):
        for record in (None, "", [], {}, {"cases": []}):
            with self.subTest(record=type(record).__name__):
                self.assertEqual(decision(record), "NO_GO")

    def test_rejects_production_fiction_and_unconfirmed_qa_environment(self):
        for project in ("atrio-catolico", "guardian-v2-qa-fixture", "", None, 2):
            report = valid_report()
            report["qa_project"] = project
            self.assertEqual(decision(report), "NO_GO")
        for field in ("qa_isolated_confirmed", "qa_iam_reviewed", "qa_costs_authorized"):
            for value in (False, None, 1, "true"):
                report = valid_report()
                report[field] = value
                self.assertEqual(decision(report), "NO_GO")

    def test_rejects_missing_duplicated_and_unknown_scenarios(self):
        report = valid_report()
        report["cases"].pop()
        self.assertEqual(decision(report), "NO_GO")
        report = valid_report()
        report["cases"][-1] = deepcopy(report["cases"][0])
        self.assertEqual(decision(report), "NO_GO")
        report = valid_report()
        report["cases"][0]["scenario"] = "skip_bad"
        self.assertEqual(decision(report), "NO_GO")

    def test_cross_identity_and_unverified_authentication_fail(self):
        for patch in ({"principal": "ACTIVATION"}, {"principal": "attacker"},
                      {"authenticated": False}, {"authenticated": 1},
                      {"pre_post_checked": False}):
            report = valid_report()
            report["cases"][0].update(patch)
            self.assertEqual(decision(report), "NO_GO")

    def test_http_401_and_ambiguous_errors_are_not_authorization_denial(self):
        for status in (0, 401, 404, 429, 500, None, True, "403"):
            report = valid_report()
            denied = next(row for row in report["cases"]
                          if row["scenario"] == "triage_direct_policy_patch")
            denied["http_status"] = status
            self.assertEqual(decision(report), "NO_GO")

    def test_http_success_is_not_a_negative_proof(self):
        report = valid_report()
        denied = next(row for row in report["cases"]
                      if row["scenario"] == "triage_direct_policy_patch")
        denied["http_status"] = 200
        self.assertEqual(decision(report), "NO_GO")

    def test_negative_response_with_side_effect_is_rejected(self):
        report = valid_report()
        denied = next(row for row in report["cases"]
                      if row["scenario"] == "triage_edit_posts")
        denied["effects_present"] = True
        self.assertEqual(decision(report), "NO_GO")

    def test_positive_write_without_verified_effect_is_rejected(self):
        report = valid_report()
        allowed = next(row for row in report["cases"]
                       if row["scenario"] == "triage_create_case_audit_notice")
        allowed["effects_present"] = False
        self.assertEqual(decision(report), "NO_GO")

    def test_read_only_positive_must_not_have_writes(self):
        report = valid_report()
        report["cases"][0]["effects_present"] = True
        self.assertEqual(decision(report), "NO_GO")

    def test_report_cannot_contain_tokens_or_raw_request_payload(self):
        report = valid_report()
        report["cases"][0]["token"] = "not-a-real-token"
        self.assertEqual(decision(report), "NO_GO")
        report = valid_report()
        report["token"] = "not-a-real-token"
        self.assertEqual(decision(report), "NO_GO")

    def test_duplicate_or_unsafely_formatted_evidence_reference_is_denied(self):
        for reference in ("https://example.test/log", "", "token", None):
            report = valid_report()
            report["cases"][0]["evidence_ref"] = reference
            self.assertEqual(decision(report), "NO_GO")
        report = valid_report()
        report["cases"][0]["evidence_ref"] = report["cases"][1]["evidence_ref"]
        self.assertEqual(decision(report), "NO_GO")

    def test_cli_is_fail_closed_and_prints_no_input_details(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(gate.main([]), 2)
        self.assertIn("NO_GO", output.getvalue())
        self.assertNotIn("atrio-catolico-qa", output.getvalue())

    def test_cli_uses_sanitized_summary_only(self):
        record = valid_report()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "evidence.json"
            path.write_text(json.dumps(record), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(gate.main([str(path)]), 0)
            self.assertIn("CANDIDATO_REVISAO_HUMANA", output.getvalue())
            self.assertNotIn("atrio-catolico-qa", output.getvalue())
            self.assertNotIn("QA-case", output.getvalue())


    def test_invalid_json_is_explicit_no_go_without_input_leak(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invalid.json"
            path.write_text('{broken:"sensitive-qa-value"}', encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(gate.main([str(path)]), 2)
            self.assertIn("NO_GO", output.getvalue())
            self.assertNotIn("sensitive-qa-value", output.getvalue())


if __name__ == "__main__":
    unittest.main()
