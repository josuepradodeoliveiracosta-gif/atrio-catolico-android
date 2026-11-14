#!/usr/bin/env python3
"""Read-only verification of the Guardian V2 GitHub environment and scheduled job.

Uses only public GitHub GET endpoints. No tokens, secret values, workflow
dispatches, environment updates or access to Google Cloud / Firebase.
"""
import json
import re
import sys
import urllib.error
import urllib.request

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
ENVIRONMENT = "guardian-v2-production-moderation"
WORKFLOW = "guardiao-v2-moderator-runner.yml"
EXPECTED_JOB = "Casos, auditoria e avisos — sem quarentena"
# Conservative cutoff: the owner's screenshot confirms the change at 11:11
# Fortaleza on 2026-11-14 (14:11 UTC). Ignore the entire transition minute.
AFTER_UTC = "2026-11-14T14:12:00Z"
API = "https://api.github.com/repos/" + REPO
SHA = re.compile(r"^[a-f0-9]{40}$")


class ReadUnavailable(Exception):
    """No untrusted HTTP body or transport detail may reach stdout."""


def get_json(path):
    # Only fixed API paths and a validated numeric job-run ID are called below.
    request = urllib.request.Request(
        API + path, headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "atrio-guardian-v2-readonly-audit",
        }, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = response.read(700001)
        if len(payload) > 700000:
            raise ReadUnavailable()
        result = json.loads(payload)
        if not isinstance(result, dict):
            raise ReadUnavailable()
        return result
    except (OSError, ValueError, UnicodeError, OverflowError) as exc:
        raise ReadUnavailable() from exc


def evaluate_environment(env, policies):
    """Return safe statuses only; never return identifiers or raw policies."""
    if not isinstance(env, dict) or not isinstance(policies, dict):
        return "INCONCLUSIVO"
    setting = env.get("deployment_branch_policy")
    branches = policies.get("branch_policies")
    if (not isinstance(setting, dict)
            or not isinstance(branches, list)
            or not isinstance(policies.get("total_count"), int)
            or not isinstance(env.get("protection_rules"), list)):
        return "INCONCLUSIVO"
    if (env.get("name") != ENVIRONMENT
            or setting.get("protected_branches") is not False
            or setting.get("custom_branch_policies") is not True
            or policies["total_count"] != 1
            or len(branches) != 1
            or not isinstance(branches[0], dict)
            or branches[0].get("name") != "main"
            or branches[0].get("type") != "branch"):
        return "REVISAR"
    if any(not isinstance(rule, dict) or rule.get("type") in
           ("required_reviewers", "wait_timer") for rule in env["protection_rules"]):
        return "REVISAR"
    return "OK"


def latest_postchange_run(data):
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise ReadUnavailable()
    runs = data["workflow_runs"]
    if not runs:
        return None
    if len(runs) > 60:
        raise ReadUnavailable()
    valid = []
    for run in runs:
        if not isinstance(run, dict):
            raise ReadUnavailable()
        created = run.get("created_at")
        if (isinstance(created, str) and
                re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", created)
                and created > AFTER_UTC and run.get("event") == "schedule"):
            valid.append(run)
    return max(valid, key=lambda x: x["created_at"]) if valid else None


def evaluate_run(run, jobs):
    if not isinstance(run, dict) or not isinstance(jobs, dict):
        return "INCONCLUSIVO"
    if (run.get("status") != "completed" or
            run.get("conclusion") is None):
        return "PENDENTE"
    if (run.get("event") != "schedule"
            or run.get("head_branch") != "main"
            or not isinstance(run.get("head_sha"), str)
            or not SHA.fullmatch(run["head_sha"])
            or run.get("conclusion") != "success"):
        return "REVISAR"
    tasks = jobs.get("jobs")
    if (not isinstance(tasks, list)
            or not isinstance(jobs.get("total_count"), int)
            or jobs["total_count"] != len(tasks)
            or len(tasks) > 100):
        return "INCONCLUSIVO"
    matches = [j for j in tasks if isinstance(j, dict)
               and j.get("name") == EXPECTED_JOB]
    return ("OK" if len(matches) == 1
            and matches[0].get("status") == "completed"
            and matches[0].get("conclusion") == "success"
            else "REVISAR")


def audit(fetch=get_json):
    env_path = "/environments/" + ENVIRONMENT
    try:
        env = fetch(env_path)
        policies = fetch(env_path + "/deployment-branch-policies")
    except ReadUnavailable:
        return {"ambiente_main": "INCONCLUSIVO", "execucao_pos_mudanca": "INCONCLUSIVO"}
    environment = evaluate_environment(env, policies)
    result = {"ambiente_main": environment, "execucao_pos_mudanca": "INCONCLUSIVO"}
    if environment != "OK":
        return result
    try:
        data = fetch("/actions/workflows/" + WORKFLOW + "/runs?event=schedule&per_page=60")
        run = latest_postchange_run(data)
        if run is None:
            result["execucao_pos_mudanca"] = "PENDENTE"
            return result
        run_id = run.get("id")
        if not isinstance(run_id, int) or run_id < 1:
            raise ReadUnavailable()
        if run.get("status") == "completed" and run.get("conclusion") == "success":
            jobs = fetch("/actions/runs/" + str(run_id) + "/jobs?per_page=100")
        else:
            jobs = {}
        result["execucao_pos_mudanca"] = evaluate_run(run, jobs)
    except ReadUnavailable:
        # Keep the post-change check INCONCLUSIVO if any read fails.
        return result
    return result


def main():
    status = audit()
    for name in ("ambiente_main", "execucao_pos_mudanca"):
        print(name + ": " + status[name])
    print("LIMITACAO: nao verifica IAM herdado, escopo Firestore, dados de usuarios, "
          "politicas de administradores ou escrita real.")
    return 0 if all(x == "OK" for x in status.values()) else 2


if __name__ == "__main__":
    sys.exit(main())
