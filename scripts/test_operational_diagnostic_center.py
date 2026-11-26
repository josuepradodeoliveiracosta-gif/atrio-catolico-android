import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_quality_report import REQUIRED, report, PR_ONLY_REQUIRED_ON_PUSH
from scripts.operational_diagnostic_center import build, markdown, read_json, ENVIRONMENTS, COMPONENTS

NOW = datetime(2026, 11, 26, 12, tzinfo=timezone.utc)
SHA = "a" * 40


def ci(event="pull_request", failure=False):
    checks = [{"name": name, "status": "completed",
               "conclusion": "failure" if failure and i == 0 else "success"}
              for i, name in enumerate(REQUIRED)
              if event != "push" or name not in PR_ONLY_REQUIRED_ON_PUSH]
    return report(SHA, checks, event)[0]


def manifest(**changes):
    observation = {"environment": "perfil_qa", "component": "authentication",
                   "state": "failed", "observed_at": "2026-11-26T11:00:00Z"}
    observation.update(changes)
    return {"schema_version": 1, "observations": [observation]}


class DiagnosticCenterTests(unittest.TestCase):
    def test_green_ci_never_implies_operational_health(self):
        result = build(ci(), now=NOW)
        self.assertEqual(result["ci"]["state"], "checks_passed")
        self.assertEqual(len(result["operational"]), len(ENVIRONMENTS) * len(COMPONENTS))
        self.assertTrue(all(x["state"] == "unknown" for x in result["operational"]))
        self.assertFalse(result["operational_health_verified"])
        self.assertFalse(result["root_cause_confirmed"])
        self.assertEqual(result["automatic_actions_executed"], 0)

    def test_push_missing_pr_checks_are_not_marked_passed(self):
        result = build(ci("push"), now=NOW)
        self.assertEqual(result["ci"]["expected_required_checks"], 2)
        self.assertEqual(result["ci"]["state"], "checks_passed")
        self.assertEqual(result["ci"]["head_freshness"], "unknown_without_current_head")

    def test_failure_is_signal_not_cause(self):
        result = build(ci(failure=True), now=NOW)
        self.assertEqual(result["ci"]["state"], "failure_observed")
        self.assertFalse(result["root_cause_confirmed"])

    def test_missing_and_unknown_event_are_incomplete(self):
        self.assertEqual(build(report(SHA, [], "pull_request")[0], now=NOW)["ci"]["state"], "incomplete")
        self.assertEqual(build(ci("unknown"), now=NOW)["ci"]["state"], "incomplete")

    def test_manual_observation_is_isolated_and_unverified(self):
        result = build(ci(), manifest(), now=NOW)
        rows = {(x["environment"], x["component"]): x for x in result["operational"]}
        item = rows["perfil_qa", "authentication"]
        self.assertEqual((item["state"], item["severity"], item["source"]),
                         ("reported_failed", "high", "manual_unverified"))
        self.assertEqual(rows["production", "authentication"]["state"], "unknown")
        self.assertIn("reported_failed", markdown(result))

    def test_expired_observation_is_not_current(self):
        result = build(ci(), manifest(observed_at="2026-11-25T11:00:00Z"), now=NOW)
        row = next(x for x in result["operational"] if x["source"] == "manual_unverified")
        self.assertEqual((row["state"], row["severity"]), ("stale", "unknown"))

    def test_free_text_secret_unknown_scope_and_future_rejected(self):
        for invalid in (manifest(token="secret"), manifest(state="secret"),
                        manifest(environment="other"), manifest(component="secret"),
                        manifest(observed_at="2026-11-27T11:00:00Z")):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                build(ci(), invalid, now=NOW)

    def test_duplicate_observations_rejected(self):
        data = manifest()
        data["observations"] *= 2
        with self.assertRaises(ValueError):
            build(ci(), data, now=NOW)

    def test_duplicate_json_keys_rejected(self):
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "input.json"
            file.write_text('{"schema_version":1,"schema_version":2}')
            with self.assertRaises(ValueError):
                read_json(file)

    def test_untrusted_check_names_never_exported(self):
        raw = report(SHA, [{"name": "SECRET-TEST", "status": "completed", "conclusion": "failure"}])[0]
        result = build(raw, now=NOW)
        self.assertNotIn("SECRET-TEST", json.dumps(result))
        self.assertNotIn("SECRET-TEST", markdown(result))


if __name__ == "__main__":
    unittest.main()
