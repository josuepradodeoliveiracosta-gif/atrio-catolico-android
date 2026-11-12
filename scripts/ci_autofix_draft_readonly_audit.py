#!/usr/bin/env python3
"""Manual GET-only reconciliation of a previously authorized QA draft PR.

This command never creates a branch, modifies a file, opens a PR, performs
a merge or deploys anything. It is not a credential-scope attestation.
No GitHub token is accepted on the command line or written to stdout.
"""
import argparse
import json
import os
import sys

from scripts.ci_autofix_pr_draft_executor import (
    GitHubDraftReader, verify_existing_qa_draft,
)

READ_TOKEN_ENV = "ATRIO_QA_READ_TOKEN"


def audit_existing_draft(checkout_root, base_sha, head_sha, pr_number,
                         *, environ=None, opener=None):
    """Run the reviewed read-only verifier with a dedicated environment token."""
    env = os.environ if environ is None else environ
    if str(env.get("GITHUB_ACTIONS", "")).lower() == "true":
        raise PermissionError("auditoria manual proibida em GitHub Actions")
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
    if (not isinstance(result, dict)
            or result.get("status") != "existing_qa_draft_verified_read_only"
            or result.get("remote_writes") != 0
            or result.get("draft") is not True
            or result.get("automatic_merge_or_deploy") is not False):
        raise ValueError("prova de auditoria remota fora do contrato")
    # A successful GET-only audit cannot establish the token's actual scopes.
    return {
        **result,
        "mode": "manually_invoked_get_only_audit",
        "credential_scope_independently_verified": False,
        "writer_executed": False,
    }


def main(argv=None, *, environ=None, opener=None, stdout=None, stderr=None):
    parser = argparse.ArgumentParser(
        description="Auditar somente por GET uma PR draft QA ja existente.")
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--pr-number", required=True, type=int)
    args = parser.parse_args(argv)
    output = sys.stdout if stdout is None else stdout
    error = sys.stderr if stderr is None else stderr
    try:
        result = audit_existing_draft(
            args.checkout_root, args.base_sha, args.head_sha,
            args.pr_number, environ=environ, opener=opener)
    except (ValueError, PermissionError, OSError):
        # Keep all failure paths free of response bodies, tokens and URLs.
        print("Auditoria bloqueada: referencias ou permissao de leitura nao "
              "verificadas. Nenhuma escrita remota executada.", file=error)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True), file=output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
