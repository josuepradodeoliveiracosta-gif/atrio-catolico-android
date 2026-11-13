#!/usr/bin/env python3
"""Manual GET-only reconciliation of a previously authorized QA draft PR.

This command never creates a branch, modifies a file, opens a PR, performs
a merge or deploys anything. It is not a credential-scope attestation.
No GitHub token is accepted on the command line or written to stdout.
"""
import argparse
import json
import os
import re
import sys

from scripts.ci_autofix_pr_draft_executor import (
    GitHubDraftReader, QA_TARGET, verify_existing_qa_draft,
)
from scripts.ci_autofix_pr_draft_plan import BRANCH_NAME
from scripts.ci_quality_report import REPO

READ_TOKEN_ENV = "ATRIO_QA_READ_TOKEN"


def audit_existing_draft(checkout_root, base_sha, head_sha, pr_number,
                         *, environ=None, opener=None):
    """Run the reviewed read-only verifier with a dedicated environment token."""
    env = os.environ if environ is None else environ
    ci_markers = ("GITHUB_ACTIONS", "CI")
    if (any(str(env.get(key, "")).strip().lower() in ("true", "1", "yes")
            for key in ci_markers)
            or any(key in env for key in
                   ("GITHUB_RUN_ID", "GITHUB_EVENT_NAME", "GITHUB_WORKFLOW"))):
        raise PermissionError("auditoria manual proibida em CI")
    token = env.get(READ_TOKEN_ENV)
    if (not isinstance(token, str) or not token
            or len(token) > 4096 or not token.isascii()
            or any(c.isspace() or ord(c) < 33 or ord(c) > 126
                   for c in token)):
        raise PermissionError("credencial de leitura manual ausente ou invalida")
    # Intentionally instantiate the GET-only class, not GitHubDraftClient.
    reader = GitHubDraftReader(token, opener)
    result = verify_existing_qa_draft(
        checkout_root, reader, base_sha, head_sha, pr_number)
    # Never forward unknown, untrusted, or secret-bearing fields to stdout.
    expected_fields = frozenset((
        "status", "repository", "pr_number", "base_sha", "head_sha",
        "branch", "draft", "only_file", "patch_sha256", "remote_writes",
        "automatic_merge_or_deploy", "human_review_required",
    ))
    if (type(result) is not dict
            or set(result) != expected_fields
            or result["status"] != "existing_qa_draft_verified_read_only"
            or result["repository"] != REPO
            or type(result["pr_number"]) is not int
            or result["pr_number"] != pr_number
            or result["base_sha"] != base_sha
            or result["head_sha"] != head_sha
            or result["branch"] != BRANCH_NAME
            or result["only_file"] != QA_TARGET
            or not isinstance(result["patch_sha256"], str)
            or re.fullmatch(r"[a-f0-9]{64}", result["patch_sha256"]) is None
            or result["draft"] is not True
            or type(result["remote_writes"]) is not int
            or result["remote_writes"] != 0
            or result["automatic_merge_or_deploy"] is not False
            or result["human_review_required"] is not True):
        raise ValueError("prova de auditoria remota fora do contrato")
    # Construct the complete public result from explicitly reviewed fields.
    # Never spread remote/unknown result objects into JSON sent to stdout.
    return {
        "status": "existing_qa_draft_verified_read_only",
        "mode": "manually_invoked_get_only_audit",
        "repository": REPO,
        "pr_number": pr_number,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "branch": BRANCH_NAME,
        "draft": True,
        "only_file": QA_TARGET,
        "patch_sha256": result["patch_sha256"],
        "remote_writes": 0,
        "automatic_merge_or_deploy": False,
        "human_review_required": True,
        "credential_scope_independently_verified": False,
        "writer_executed": False,
    }


def main(argv=None, *, environ=None, opener=None, stdout=None, stderr=None):
    parser = argparse.ArgumentParser(
        description="Auditar somente por GET uma PR draft QA ja existente.")
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    # Never let argparse echo an accidental token supplied as an unknown
    # argument or in a numeric field back to the terminal.
    parser.add_argument("--pr-number", required=True)
    output = sys.stdout if stdout is None else stdout
    error = sys.stderr if stderr is None else stderr
    try:
        # parse_known_args allows us to reject unknown arguments silently
        # instead of argparse printing their (possibly secret) values.
        args, unknown = parser.parse_known_args(argv)
        if (unknown or not re.fullmatch(r"[1-9][0-9]{0,11}",
                                         args.pr_number)):
            raise ValueError("argumentos invalidos")
        result = audit_existing_draft(
            args.checkout_root, args.base_sha, args.head_sha,
            int(args.pr_number), environ=environ, opener=opener)
    except (ValueError, PermissionError, OSError):
        # Keep all failure paths free of response bodies, tokens and URLs.
        print("Auditoria bloqueada: referencias ou permissao de leitura nao "
              "verificadas. Nenhuma escrita remota executada.", file=error)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True), file=output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
