"""Contract tests for read-only automatic QA run audit (all fixtures)."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_autofix_run_outcomes import (
    REPO, WORKFLOW, PATH, PREFLIGHT, WRITER,
    MAX_RUNS, audit, canonical_run_id, get_json, inspect_run, markdown, write_report,
)

SHA = "a" * 40
ID = 43470376122


def example(run_id=ID, preflight="success", writer="skipped"):
    run = {
        "id": run_id, "name": WORKFLOW, "path": PATH, "event": "workflow_run",
        "head_branch": "main", "head_sha": SHA, "run_attempt": 1,
        "repository": {"full_name": REPO},
        "head_repository": {"full_name": REPO},
        "status": "completed", "conclusion": "success",
    }
    jobs = {
        "total_count": 2,
        "jobs": [
            {"id": 100, "name": PREFLIGHT, "run_id": run_id,
             "head_sha": SHA, "run_attempt": 1, "status": "completed",
             "conclusion": preflight},
            {"id": 101, "name": WRITER, "run_id": run_id,
             "head_sha": SHA, "run_attempt": 1, "status": "completed",
             "conclusion": writer},
        ],
    }
    return run, jobs


class AutoRunOutcomeTests(unittest.TestCase):
    def test_skipped_writer_is_never_credited_as_fix(self):
        run, jobs = example()
        row = inspect_run(ID, run, jobs)
        self.assertEqual(row["observed_outcome"], "writer_not_executed")
        self.assertFalse(row["verified_automatic_repair"])
        self.assertFalse(row["verified_eligible_procedure"])
        self.assertEqual(row["writer_conclusion"], "skipped")
        self.assertEqual(row["run_url"],
                         f"https://github.com/{REPO}/actions/runs/{ID}")

    def test_writer_success_still_does_not_prove_pr_or_fix(self):
        run, jobs = example(writer="success")
        result = inspect_run(ID, run, jobs)
        self.assertEqual(result["observed_outcome"],
                         "writer_job_success_not_verified_pr_or_fix")
        self.assertFalse(result["verified_automatic_repair"])

    def test_aggregate_only_observed_metadata_never_fake_percentage(self):
        cases = {}
        for offset in range(3):
            run_id = ID + offset
            cases[run_id] = example(run_id=run_id)
        def fetch(run_id, jobs):
            return deepcopy(cases[run_id][1 if jobs else 0])
        result = audit(list(cases), fetch)
        self.assertEqual(result["observed_auto_workflow_runs"], 3)
        self.assertEqual(result["preflight_success"], 3)
        self.assertEqual(result["writer_skipped"], 3)
        self.assertEqual(result["writer_job_succeeded"], 0)
        self.assertIsNone(result["eligible_procedures_verified"])
        self.assertIsNone(result["automated_repairs_independently_verified"])
        self.assertIsNone(result["measured_automatic_repair_success_percent"])
        self.assertFalse(result["manual_workflows_counted"])
        self.assertIn("nao calculavel", markdown(result))
        self.assertNotIn("99% alcancados", markdown(result))

    def test_no_untrusted_run_identity_or_manual_qa_workflow(self):
        run, jobs = example()
        mutators = [
            lambda x: x.update(name="QA - Criar PR documental draft com GitHub App (manual)"),
            lambda x: x.update(event="workflow_dispatch"),
            lambda x: x.update(path=".github/workflows/qa-doc-app-draft-manual.yml"),
            lambda x: x.update(head_branch="other"),
            lambda x: x.update(head_sha="wrong"),
            lambda x: x.update(run_attempt=2),
            lambda x: x["repository"].update(full_name="attacker/other"),
            lambda x: x["head_repository"].update(full_name="attacker/other"),
            lambda x: x.update(status="in_progress"),
            lambda x: x.update(conclusion=None),
            lambda x: x.update(id=ID + 1),
        ]
        for mutate in mutators:
            with self.subTest(mutate=repr(mutate)):
                fake = deepcopy(run)
                mutate(fake)
                with self.assertRaises(ValueError):
                    inspect_run(ID, fake, jobs)

    def test_wrong_jobs_duplicate_or_retry_rejected(self):
        run, jobs = example()
        mutations = [
            lambda j: j.update(total_count=100),
            lambda j: j["jobs"][0].update(name=WRITER),
            lambda j: j["jobs"][1].update(name="arbitrary write"),
            lambda j: j["jobs"][1].update(run_id=ID + 1),
            lambda j: j["jobs"][1].update(head_sha="b" * 40),
            lambda j: j["jobs"][1].update(run_attempt=2),
            lambda j: j["jobs"][1].update(status="in_progress"),
            lambda j: j["jobs"][1].update(id=True),
            lambda j: j["jobs"].append(deepcopy(j["jobs"][0])),
        ]
        for mutate in mutations:
            with self.subTest(mutate=repr(mutate)):
                fake = deepcopy(jobs)
                mutate(fake)
                with self.assertRaises(ValueError):
                    inspect_run(ID, run, fake)

    def test_no_writer_when_preflight_fails(self):
        run, jobs = example(preflight="failure", writer="skipped")
        self.assertEqual(inspect_run(ID, run, jobs)["observed_outcome"],
                         "preflight_did_not_pass")
        run, jobs = example(preflight="failure", writer="success")
        with self.assertRaises(ValueError):
            inspect_run(ID, run, jobs)

    def test_ids_and_sample_size_are_bounded(self):
        def fake(_, __):
            raise AssertionError("unexpected GitHub fetch")
        for ids in ([], [True], ["1"], [ID, ID],
                    list(range(1, MAX_RUNS + 2))):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                audit(ids, fake)

    def test_cli_backend_uses_only_two_fixed_gets_per_id(self):
        calls = []
        run, jobs = example()
        def fake(run_id, token, *, jobs=False):
            calls.append((run_id, token, jobs))
            return deepcopy(jobs_page if jobs else run)
        jobs_page = jobs
        with TemporaryDirectory() as folder:
            json_path = Path(folder) / "out.json"
            md_path = Path(folder) / "out.md"
            result = write_report([ID], "test-token", json_path, md_path,
                                  fetcher=fake)
            self.assertEqual(calls, [(ID, "test-token", False),
                                     (ID, "test-token", True)])
            self.assertEqual(result["writer_skipped"], 1)
            self.assertNotIn("test-token", json_path.read_text(encoding="utf-8"))
            self.assertNotIn("test-token", md_path.read_text(encoding="utf-8"))
            with self.assertRaises(ValueError):
                write_report([ID], "test-token", json_path, json_path,
                             fetcher=fake)

    def test_canonical_ids_reject_ambiguous_types_without_network(self):
        for good in (ID, str(ID), 1, "1", 10**18 - 1):
            with self.subTest(good=good):
                self.assertEqual(canonical_run_id(good), int(good))
        for bad in (
            True, False, 0, 1.0, 1.9, -1, 10**18,
            "01", "1.0", "+1", " 1", "1 ", "1e3", "１２",
            None, [], {}, b"1",
        ):
            with self.subTest(bad=repr(bad)):
                with self.assertRaises(ValueError):
                    canonical_run_id(bad)
                with self.assertRaises(ValueError):
                    get_json(bad, "test-token")

    def test_metadata_fetch_requires_token_even_before_network(self):
        for bad in ("", None, "a" * 4097):
            with self.subTest(token=repr(bad)), self.assertRaises(ValueError):
                get_json(ID, bad)


if __name__ == "__main__":
    unittest.main()
