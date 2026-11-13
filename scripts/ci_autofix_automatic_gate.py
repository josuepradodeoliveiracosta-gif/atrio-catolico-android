#!/usr/bin/env python3
"""Trusted GitHub Actions gate for an *approved, fixed* QA-only draft recipe.

Automatic means no operator prompt once the workflow code is reviewed on main.
It NEVER accepts code, paths, commands, URLs or patches from CI artifacts.
PRs remain draft and must be reviewed before any merge.
"""
import argparse
import json
import os
from pathlib import Path

from scripts.ci_quality_report import REPO, validate_sha
from scripts.ci_autofix_handoff import read_json_bounded
from scripts.ci_autofix_pr_draft_plan import draft_pr_plan
from scripts.ci_autofix_pr_draft_executor import (
    CONFIRMATION, GitHubDraftClient, execute_manually_approved_draft,
    validate_draft_manifest,
)

TRUSTED_WORKFLOW = "Autocorrecao QA - PR draft automatica"
TRUSTED_TRIGGER = "Revisão automática - CodeQL (Kotlin, JS, Python e Actions)"
MAX_EVENT_BYTES = 512_000


def verify_trusted_event(event, env):
    """Only a successful CodeQL *push on main* in this repository is trusted."""
    if (type(event) is not dict or type(env) is not dict
            or env.get("GITHUB_ACTIONS") != "true"
            or env.get("GITHUB_EVENT_NAME") != "workflow_run"
            or env.get("GITHUB_WORKFLOW") != TRUSTED_WORKFLOW
            or env.get("GITHUB_REPOSITORY") != REPO
            or env.get("GITHUB_REF") != "refs/heads/main"):
        raise PermissionError("evento de automacao nao confiavel")
    run = event.get("workflow_run")
    if (type(run) is not dict
            or type(event.get("repository")) is not dict
            or event["repository"].get("full_name") != REPO
            or type(run.get("head_repository")) is not dict
            or run["head_repository"].get("full_name") != REPO
            or run.get("name") != TRUSTED_TRIGGER
            or run.get("event") != "push"
            or run.get("head_branch") != "main"
            or run.get("conclusion") != "success"
            or type(run.get("id")) is not int or run["id"] < 1):
        raise PermissionError("origem do workflow nao autoriza PR")
    return validate_sha(run.get("head_sha"))


def read_event_file(path):
    file = Path(path)
    if not file.is_file() or file.stat().st_size > MAX_EVENT_BYTES:
        raise ValueError("evento GitHub ausente ou acima do limite")
    return json.loads(file.read_text(encoding="utf-8"))


def select_candidate(plan, handoff, source_sha, root):
    """A read-only descriptor is evidence, never an instruction to write."""
    if (type(plan) is not dict or type(handoff) is not dict
            or handoff.get("repository") != REPO
            or handoff.get("commit_sha") != source_sha
            or plan.get("repository") != REPO
            or plan.get("source_sha") != source_sha):
        raise ValueError("manifesto e origem nao correlacionados")
    status = plan.get("status")
    if status != "draft_pr_descriptor_ready_for_review":
        # No eligible, approved recipe means no write job. This is expected
        # while the already-reviewed QA branch and PR #261 exist.
        return False
    if (handoff.get("status") != "draft_pr_intent_review_required"
            or handoff.get("patch_preview_verified") is not True
            or handoff.get("permission_to_write_repo") is not False
            or handoff.get("production_access") is not False):
        raise ValueError("handoff QA nao verificado")
    sha, _ = validate_draft_manifest(plan, root)
    if sha != source_sha:
        raise ValueError("SHA aprovado nao corresponde ao evento GitHub")
    return True


def execute_trusted_automatic_draft(plan, handoff, event, env, root, client):
    """Reverify *fresh* main/branch/PR state before the one allowed transaction."""
    sha = verify_trusted_event(event, env)
    if not select_candidate(plan, handoff, sha, root):
        raise ValueError("nenhum reparo QA elegivel para escrita")
    # Independently reconstruct the exact descriptor from the live GitHub API.
    # Trust neither downloaded artifacts nor an earlier read-only snapshot.
    expected = draft_pr_plan(handoff, root, client.live_context())
    if expected != plan:
        raise ValueError("plano mudou desde o diagnostico; nenhuma escrita")
    # The only pre-approval is the audited, immutable recipe in the reviewed
    # workflow itself. CONFIRMATION remains the backend's static transaction
    # safeguard; no user-provided confirmation string or API path is accepted.
    result = execute_manually_approved_draft(
        plan, root, client, sha, CONFIRMATION)
    if (result.get("status") != "draft_pr_created_review_required"
            or result.get("draft") is not True
            or result.get("merged") is not False
            or result.get("requires_human_review") is not True
            or result.get("automatic_merge_or_deploy") is not False):
        raise ValueError("resposta de criacao nao atende contrato de seguranca")
    return result


def main(argv=None, *, env=None):
    parser = argparse.ArgumentParser(description="Gate de PR QA automatica.")
    parser.add_argument("--phase", choices=("event", "select", "write"),
                        required=True)
    parser.add_argument("--checkout-root", default=".")
    parser.add_argument("--manifest")
    parser.add_argument("--handoff")
    args = parser.parse_args(argv)
    environment = os.environ if env is None else env
    event = read_event_file(environment.get("GITHUB_EVENT_PATH", ""))
    source_sha = verify_trusted_event(event, environment)
    if args.phase == "event":
        print("Gatilho autenticado: CodeQL push main, SHA " + source_sha)
        return 0
    if not args.manifest or not args.handoff:
        raise ValueError("artefatos de QA ausentes")
    plan = read_json_bounded(args.manifest)
    handoff = read_json_bounded(args.handoff)
    eligible = select_candidate(plan, handoff, source_sha, args.checkout_root)
    if args.phase == "select":
        output_path = environment.get("GITHUB_OUTPUT")
        if not output_path:
            raise PermissionError("saida do GitHub Actions indisponivel")
        with open(output_path, "a", encoding="utf-8") as output:
            output.write("eligible=" + ("true" if eligible else "false") + "\n")
            output.write("source_sha=" + source_sha + "\n")
        print("Receita autonoma elegivel: " + ("sim" if eligible else "nao"))
        return 0
    if not eligible:
        raise ValueError("o escritor nao pode iniciar sem receita aprovada")
    token = environment.get("GITHUB_TOKEN")
    if not isinstance(token, str) or not token or len(token) > 4096:
        raise PermissionError("credencial temporaria do job ausente")
    client = GitHubDraftClient(token)
    result = execute_trusted_automatic_draft(
        plan, handoff, event, environment, args.checkout_root, client)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
