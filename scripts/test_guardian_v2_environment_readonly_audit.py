"""Pure offline regression tests for GitHub environment and scheduled run audit."""
import contextlib
import io
import json
from unittest import TestCase, mock

from scripts import guardian_v2_environment_readonly_audit as guard


def environment():
    return {
        "name": guard.ENVIRONMENT,
        "deployment_branch_policy": {
            "protected_branches": False,
            "custom_branch_policies": True,
        },
        "protection_rules": [],
        "can_admins_bypass": True,
    }


def policies():
    return {"total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}]}


def scheduled_run(**kwargs):
    result = {
        "id": 12345,
        "created_at": "2026-11-14T15:15:00Z",
        "event": "schedule",
        "status": "completed",
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": "a" * 40,
    }
    result.update(kwargs)
    return result


def tasks():
    return {
        "total_count": 2,
        "jobs": [
            {"name": guard.EXPECTED_JOB, "status": "completed", "conclusion": "success"},
            {"name": "Ativação da política via WIF (sem moderação)",
             "status": "completed", "conclusion": "skipped"},
        ],
    }


def simulate(env=None, branch=None, runs=None, jobs=None):
    env = environment() if env is None else env
    branch = policies() if branch is None else branch
    runs = {"workflow_runs": [scheduled_run()]} if runs is None else runs
    jobs = tasks() if jobs is None else jobs
    calls = []

    def fetch(path):
        calls.append(path)
        if path.endswith("/deployment-branch-policies"):
            return branch
        if "/environments/" in path:
            return env
        if "/runs?" in path:
            return runs
        if "/jobs?" in path:
            return jobs
        raise AssertionError("Unexpected endpoint in read-only audit")

    return guard.audit(fetch), calls


class ReadonlyEnvironmentTests(TestCase):
    def test_expected_environment_and_scheduled_run_pass(self):
        result, calls = simulate()
        self.assertEqual(result, {"ambiente_main": "OK", "execucao_pos_mudanca": "OK"})
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(c.startswith("/") for c in calls))

    def test_environment_requires_exact_main(self):
        for v in ("release/*", "*", "main/*", "master"):
            with self.subTest(branch=v):
                b = policies()
                b["branch_policies"][0]["name"] = v
                self.assertEqual(guard.evaluate_environment(environment(), b), "REVISAR")

    def test_environment_refuses_extra_allowed_branches(self):
        b = policies()
        b["total_count"] = 2
        b["branch_policies"].append({"name": "develop", "type": "branch"})
        self.assertEqual(guard.evaluate_environment(environment(), b), "REVISAR")

    def test_environment_unrestricted_or_malformed_fails_closed(self):
        e = environment()
        e["deployment_branch_policy"] = None
        self.assertEqual(guard.evaluate_environment(e, policies()), "INCONCLUSIVO")
        e = environment()
        e["deployment_branch_policy"]["custom_branch_policies"] = False
        self.assertEqual(guard.evaluate_environment(e, policies()), "REVISAR")
        self.assertEqual(guard.evaluate_environment({}, {}), "INCONCLUSIVO")

    def test_unexpected_approval_gate_is_flagged(self):
        e = environment()
        e["protection_rules"] = [{"type": "required_reviewers"}]
        result, calls = simulate(env=e)
        self.assertEqual(result["ambiente_main"], "REVISAR")
        self.assertEqual(len(calls), 2)

    def test_run_before_cutoff_not_accepted(self):
        result, calls = simulate(runs={"workflow_runs": [scheduled_run(
            created_at="2026-11-14T14:09:20Z")]})
        self.assertEqual(result["execucao_pos_mudanca"], "PENDENTE")
        self.assertEqual(len(calls), 3)

    def test_latest_postchange_run_must_succeed(self):
        older = scheduled_run(created_at="2026-11-14T15:15:00Z")
        newer = scheduled_run(created_at="2026-11-14T16:20:00Z",
                              conclusion="failure", id=12346)
        result, calls = simulate(runs={"workflow_runs": [older, newer]})
        self.assertEqual(result["execucao_pos_mudanca"], "REVISAR")
        self.assertEqual(len(calls), 3)

    def test_incomplete_run_remains_pending(self):
        run = scheduled_run(status="in_progress", conclusion=None)
        result, _ = simulate(runs={"workflow_runs": [run]})
        self.assertEqual(result["execucao_pos_mudanca"], "PENDENTE")

    def test_bad_job_or_sha_refuses_false_success(self):
        run = scheduled_run(head_sha="not-a-real-sha")
        self.assertEqual(guard.evaluate_run(run, tasks()), "REVISAR")
        j = tasks()
        j["jobs"][0]["conclusion"] = "skipped"
        self.assertEqual(guard.evaluate_run(scheduled_run(), j), "REVISAR")
        self.assertEqual(guard.evaluate_run(scheduled_run(), {}), "INCONCLUSIVO")

    def test_run_id_cannot_inject_endpoint(self):
        result, calls = simulate(runs={"workflow_runs": [scheduled_run(id="1?foo=bar")]})
        self.assertEqual(result["execucao_pos_mudanca"], "INCONCLUSIVO")
        self.assertEqual(len(calls), 3)

    def test_network_errors_do_not_print_sensitive_body(self):
        def fail(_):
            raise guard.ReadUnavailable("SENSITIVE_FAKE_DATA")
        self.assertEqual(guard.audit(fail),
                         {"ambiente_main": "INCONCLUSIVO",
                          "execucao_pos_mudanca": "INCONCLUSIVO"})
        captured = io.StringIO()
        with mock.patch.object(guard, "audit", return_value=guard.audit(fail)), \
             contextlib.redirect_stdout(captured):
            self.assertEqual(guard.main(), 2)
        self.assertNotIn("SENSITIVE_FAKE_DATA", captured.getvalue())

    def test_http_request_is_anonymous_and_get_only(self):
        body = json.dumps(environment()).encode()
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = body
        with mock.patch.object(guard.urllib.request, "urlopen", return_value=response) as req:
            self.assertEqual(guard.get_json("/environments/" + guard.ENVIRONMENT),
                             environment())
        sent = req.call_args.args[0]
        self.assertEqual(sent.get_method(), "GET")
        self.assertNotIn("Authorization", dict(sent.header_items()))


if __name__ == "__main__":
    import unittest
    unittest.main()
