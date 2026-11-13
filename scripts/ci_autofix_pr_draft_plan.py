#!/usr/bin/env python3
"""Read-only planner for a future DRAFT PR from a verified CI handoff.

The existing diagnosis/sandbox pipeline remains the source of truth.
Fetch ONLY fixed GitHub API endpoints for the current main SHA and open PR
heads, checking staleness and deduplication before writing a bounded preview.
This module NEVER creates a branch, commit, pull request, merge or deployment.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from scripts.ci_quality_report import NoRedirect, REPO, validate_sha
from scripts.ci_autofix_handoff import read_json_bounded
from scripts.ci_autofix_qa_review import (
    PATCH_ID, QA_TARGET, QA_TARGET_SHA256, preview_real_qa_patch,
)

MAX_REMOTE_RESPONSE_BYTES = 1_000_000
MAX_OPEN_PR_ROWS = 99
# Use short pages: a single 100-PR GitHub response can exceed the 1 MB
# response limit even when fewer than MAX_OPEN_PR_ROWS are open.
MAX_OPEN_PR_PAGE_SIZE = 10
BRANCH_NAME = "qa/autofix-ci-scope-main"
BASE_BRANCH = "main"
STATIC_TITLE = "fix(qa): identificar checks exclusivos de PR no relatorio CI"
ALLOWED_STATUSES = frozenset((
    "draft_pr_intent_review_required", "blocked_event_or_branch",
    "blocked_required_check_pattern", "blocked_already_applied",
    "blocked_competing_failure_or_log_evidence",
))
STATIC_BODY = (
    "Correcao proposta por evidencia de checks exclusivos de PR ausentes "
    "em push da main. Alteracao limitada a scripts/ci_quality_report.py.\n\n"
    "Esta PR deve permanecer em RASCUNHO, com revisao humana e todos os "
    "testes de seguranca e regressao completos antes de qualquer merge.\n\n"
    "Nao promover checks ausentes a sucesso; sem acesso a producao."
)


def _get_api(path, token, opener, allow_not_found=False):
    """Fixed-host HTTPS, no redirect, strict byte limit, no URLs from artifacts."""
    url = "https://api.github.com/repos/" + REPO + path
    req = Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with opener(req, timeout=20) as response:
            body = response.read(MAX_REMOTE_RESPONSE_BYTES + 1)
    except HTTPError as error:
        # urllib.error.HTTPError owns the underlying response stream.
        # Close it for both the expected 404 and fatal HTTP failures.
        error.close()
        if allow_not_found and error.code == 404:
            return None
        raise
    if len(body) > MAX_REMOTE_RESPONSE_BYTES:
        raise ValueError("resposta de GitHub acima do limite")
    return json.loads(body)


def fetch_live_pr_context(token, opener=None):
    """Check main SHA, OPEN PRs and target branch with read-only API calls.

    If more than 99 PRs are open, refuse rather than silently missing a
    duplicate on another page. Never copy PR titles, descriptions or URLs.
    This is only a snapshot; an eventual writer must recheck atomically.
    """
    if not isinstance(token, str) or not token:
        raise ValueError("token GitHub de leitura ausente")
    if opener is None:
        opener = build_opener(NoRedirect).open
    branch = _get_api("/branches/main", token, opener)
    if not isinstance(branch, dict) or not isinstance(branch.get("commit"), dict):
        raise ValueError("resposta de main invalida")
    main_sha = validate_sha(branch["commit"].get("sha"))
    # Fetch all open PRs in bounded pages. Never use only the first page:
    # missing a later draft could cause duplicate or unsafe remote writes.
    items = []
    page = 1
    while True:
        path = ("/pulls?state=open&per_page="
                + str(MAX_OPEN_PR_PAGE_SIZE) + "&page=" + str(page))
        rows = _get_api(path, token, opener)
        if (type(rows) is not list
                or len(rows) > MAX_OPEN_PR_PAGE_SIZE
                or len(items) + len(rows) > MAX_OPEN_PR_ROWS):
            raise ValueError("PRs acima do limite de pagina segura")
        items.extend(rows)
        if len(rows) < MAX_OPEN_PR_PAGE_SIZE:
            break
        page += 1
    open_branches = []
    seen_pr_numbers = set()
    for entry in items:
        if (not isinstance(entry, dict)
                or entry.get("state") != "open"
                or type(entry.get("number")) is not int
                or not 0 < entry["number"] < 10 ** 12
                or not isinstance(entry.get("head"), dict)
                or not isinstance(entry.get("base"), dict)):
            raise ValueError("metadados de PR invalidos")
        if entry["number"] in seen_pr_numbers:
            raise ValueError("PR repetida entre paginas: contexto inconsistente")
        seen_pr_numbers.add(entry["number"])
        head = entry["head"]
        if not isinstance(head.get("repo"), dict):
            raise ValueError("origem de PR nao verificavel")
        if (head["repo"].get("full_name") == REPO
                and head.get("ref") == BRANCH_NAME
                and entry["base"].get("ref") == BASE_BRANCH):
            open_branches.append(entry["number"])
    # A pre-existing branch without an open PR can contain valuable work.
    # A 404 from the exact fixed ref means it is absent for this snapshot.
    # Any other HTTP error must be fatal, never treated as branch absence.
    target_ref = "refs/heads/" + BRANCH_NAME
    branch_info = _get_api(
        "/git/ref/heads/" + BRANCH_NAME, token, opener,
        allow_not_found=True)
    if branch_info is not None and (
            not isinstance(branch_info, dict)
            or branch_info.get("ref") != target_ref):
        raise ValueError("resposta da branch de reparo nao confiavel")
    return {
        "main_sha": main_sha,
        "duplicate_pr_numbers": sorted(open_branches),
        "target_branch_exists": branch_info is not None,
    }


def _base_result(sha, status):
    return {
        "schema_version": 1,
        "mode": "read_only_draft_pr_planning",
        "repository": REPO,
        "source_sha": sha,
        "status": status,
        "patch_id": PATCH_ID,
        "target_path": QA_TARGET,
        "base_branch": BASE_BRANCH,
        "head_branch": BRANCH_NAME,
        "duplicate_pr_numbers": [],
        "target_branch_absence_checked": False,
        "live_main_sha_checked": False,
        "candidate_patch_verified": False,
        "draft_pr_title": None,
        "draft_pr_body": None,
        "draft_pr_created": False,
        "changes_to_checkout": 0,
        "remote_writes": 0,
        "merges_or_deploys": 0,
        "production_access": False,
        "human_approval_required_before_merge": True,
        "current_automation_percent_measured": None,
    }


def draft_pr_plan(handoff, checkout_root, read_context=None):
    """Only a *descriptor*, even when evidence is fresh and no PR is open."""
    if not isinstance(handoff, dict):
        raise ValueError("handoff de CI invalido")
    sha = validate_sha(handoff.get("commit_sha"))
    if (handoff.get("repository") != REPO
            or handoff.get("mode") != "read_only_review_intent"
            or type(handoff.get("schema_version")) is not int
            or handoff["schema_version"] != 1
            or handoff.get("patch_id") != PATCH_ID
            or handoff.get("reviewed_file") != QA_TARGET
            or handoff.get("status") not in ALLOWED_STATUSES
            or handoff.get("review_intent_only") is not True
            or handoff.get("permission_to_write_repo") is not False
            or handoff.get("current_pr_head_verified") is not False
            or handoff.get("production_access") is not False
            or handoff.get("measured_automation_percent") is not None):
        raise ValueError("contrato de handoff inseguro")
    for key in ("automatic_pull_requests_created", "automatic_repairs_executed",
                "merges_or_deploys"):
        if type(handoff.get(key)) is not int or handoff[key] != 0:
            raise ValueError("handoff indica escrita remota")
    status = handoff["status"]
    result = _base_result(sha, "blocked_by_handoff")
    if status != "draft_pr_intent_review_required":
        if handoff.get("draft_pr_intent_id") is not None:
            raise ValueError("handoff bloqueado nao pode conter intento")
        return result
    if (handoff.get("draft_pr_intent_id") != "atrio-qa-scope-" + sha[:12]
            or handoff.get("patch_preview_verified") is not True
            or handoff.get("source_sha256") != QA_TARGET_SHA256
            or not isinstance(handoff.get("patched_sha256"), str)
            or handoff.get("regression_validation") != "requires_ci_tests"):
        raise ValueError("candidato de handoff nao comprovado")
    # Independently verify the pinned patch in a disposable sandbox.
    proof = preview_real_qa_patch(checkout_root)
    if (handoff["patched_sha256"] != proof["patched_sha256"]
            or proof["checkout_files_changed"] != 0
            or proof["sandbox_rollback_verified"] is not True):
        raise ValueError("preview de sandbox nao coincide com intento")
    result["candidate_patch_verified"] = True
    if read_context is None:
        result["status"] = "blocked_live_context_unavailable"
        return result
    if (not isinstance(read_context, dict)
            or not isinstance(read_context.get("duplicate_pr_numbers"), list)
            or type(read_context.get("target_branch_exists")) is not bool
            or any(type(x) is not int or not 0 < x < 10 ** 12
                   for x in read_context["duplicate_pr_numbers"])):
        raise ValueError("contexto GitHub invalido")
    main_sha = validate_sha(read_context.get("main_sha"))
    result["live_main_sha_checked"] = True
    result["target_branch_absence_checked"] = True
    if main_sha != sha:
        result["status"] = "blocked_stale_main_head"
        return result
    if read_context["duplicate_pr_numbers"]:
        result["status"] = "blocked_existing_pr"
        result["duplicate_pr_numbers"] = sorted(set(
            read_context["duplicate_pr_numbers"]))
        return result
    if read_context["target_branch_exists"]:
        result["status"] = "blocked_existing_branch"
        return result
    result.update({
        "status": "draft_pr_descriptor_ready_for_review",
        "draft_pr_title": STATIC_TITLE,
        "draft_pr_body": STATIC_BODY + "\n\nSHA base revisado: " + sha,
        "preview_source_sha256": proof["source_sha256"],
        "preview_patch_sha256": proof["patched_sha256"],
        "premerge_ci_validation": "required_not_yet_verified",
        "draft_only": True,
        "eligible_for_automatic_remote_write": False,
        "race_window_remains": True,
    })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--handoff", required=True)
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--json", required=True)
    args = parser.parse_args()
    handoff = read_json_bounded(args.handoff)
    # Blocked handoffs never call GitHub API and cannot escalate.
    if (isinstance(handoff, dict)
            and handoff.get("status") == "draft_pr_intent_review_required"):
        context = fetch_live_pr_context(os.environ.get("GITHUB_TOKEN", ""))
    else:
        context = None
    plan = draft_pr_plan(handoff, args.checkout_root, context)
    Path(args.json).write_text(
        json.dumps(plan, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8")
    print("Preparacao PR:", plan["status"], "(sem qualquer escrita remota)")


if __name__ == "__main__":
    main()
