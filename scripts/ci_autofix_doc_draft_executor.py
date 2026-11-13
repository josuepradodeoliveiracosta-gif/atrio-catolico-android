#!/usr/bin/env python3
"""Simulate a strictly pinned QA documentation draft transaction.

This module is intentionally MEMORY-ONLY: no HTTP client, no tokens, no CLI,
no GitHub Actions step, and no API adapter. A separately reviewed change is
required before any remote write is possible. Do not run from privileged CI.
"""
from scripts.ci_quality_report import REPO, validate_sha
from scripts.ci_autofix_doc_candidate import (
    TARGET, SOURCE_BLOB_SHA1, PATCH_ID, _git_blob_sha, _pinned_source,
    patch_static_source, preview_doc_candidate,
)

BRANCH = "qa/autofix-doc-history-v1"
BASE = "main"
TITLE = "docs(qa): atualizar instrucao historica de integracao"
BODY_PREFIX = (
    "Correcao documental QA previamente revisada e fixada por hash. "
    "Altera exclusivamente docs/ci/autocorrecao-automatica-github-app-"
    "2026-11-12.md.\n\n"
    "Esta PR DEVE permanecer em rascunho; exigir revisao humana e checks "
    "antes de qualquer merge. Sem deploy, acesso a producao ou backup.\n\n"
    "Receita: " + PATCH_ID + "\nSHA base: "
)
CONFIRMATION = "SIMULATE_DOC_DRAFT_ONLY"


def _snapshot(context, expected_sha, *, branch_exists):
    if (type(context) is not dict
            or set(context) != {"main_sha", "branch_exists", "duplicate_pr_numbers"}
            or context.get("main_sha") != expected_sha
            or context.get("branch_exists") is not branch_exists
            or context.get("duplicate_pr_numbers") != []):
        raise ValueError("main, branch ou PR mudou; transacao bloqueada")


def _checked_file(reply, expected_text, expected_blob):
    if (type(reply) is not dict
            or set(reply) != {"sha", "source"}
            or reply.get("sha") != expected_blob
            or reply.get("source") != expected_text
            or type(reply["source"]) is not str
            or _git_blob_sha(reply["source"].encode("utf-8")) != expected_blob):
        raise ValueError("conteudo remoto nao coincide com o documento QA fixo")


class InMemoryDraftClient:
    """Tiny deterministic GitHub-like model, with NO external capabilities.

    Failure injection is test-only. Never reuse this as a production HTTP
    client or as evidence of successful GitHub App write permissions.
    """

    def __init__(self, main_sha, source, *, fault=None):
        self.main_sha = main_sha
        self.source = source
        self.branch_exists = False
        self.branch_file = None
        self.pr_exists = False
        self.fault = fault
        self.events = []

    def live(self):
        self.events.append("live")
        sha = "b" * 40 if self.fault == "main_drift" else self.main_sha
        if self.fault == "post_branch_main_drift" and self.branch_exists:
            sha = "b" * 40
        return {
            "main_sha": sha,
            "branch_exists": self.branch_exists or self.fault == "existing_branch",
            "duplicate_pr_numbers": [999] if self.pr_exists or self.fault == "existing_pr" else [],
        }

    def base_document(self):
        self.events.append("base_document")
        content = self.source + "\n" if self.fault == "base_drift" else self.source
        blob = _git_blob_sha(content.encode("utf-8"))
        return {"sha": blob, "source": content}

    def create_branch(self, name, sha):
        self.events.append("create_branch")
        if name != BRANCH or sha != self.main_sha or self.branch_exists:
            raise ValueError("branch QA nao autorizada")
        self.branch_exists = True
        self.branch_file = self.source
        if self.fault == "branch_response_wrong":
            return {"ref": "refs/heads/unknown", "sha": sha}
        return {"ref": "refs/heads/" + BRANCH, "sha": sha}

    def branch_document(self):
        self.events.append("branch_document")
        content = self.branch_file
        if self.fault == "branch_drift" and self.branch_file == self.source:
            content += "\n"
        if self.fault == "write_corruption" and self.branch_file != self.source:
            content += "\n"
        return {"sha": _git_blob_sha(content.encode("utf-8")), "source": content}

    def write_document(self, branch, path, expected_blob, changed_source):
        self.events.append("write_document")
        if (branch != BRANCH or path != TARGET or not self.branch_exists
                or expected_blob != _git_blob_sha(self.source.encode("utf-8"))
                or self.branch_file != self.source):
            raise ValueError("escrita simulada fora do unico arquivo autorizado")
        self.branch_file = changed_source
        sha = _git_blob_sha(changed_source.encode("utf-8"))
        if self.fault == "write_response_wrong":
            sha = "c" * 40
        return {"path": TARGET, "sha": sha, "commit_sha": "d" * 40}

    def compare(self, main_sha, branch):
        self.events.append("compare")
        if main_sha != self.main_sha or branch != BRANCH:
            raise ValueError("comparacao de branches fora do contrato")
        files = [{"filename": TARGET, "status": "modified"}]
        if self.fault == "extra_diff":
            files.append({"filename": "app/src/main/forbidden.kt", "status": "modified"})
        return {"ahead_by": 1, "behind_by": 0, "files": files}

    def create_pr(self, head, base, title, body):
        self.events.append("create_pr")
        if (not self.branch_exists or self.pr_exists or head != BRANCH
                or base != BASE or title != TITLE
                or body != BODY_PREFIX + self.main_sha):
            raise ValueError("PR nao corresponde a receita QA aprovada")
        self.pr_exists = True
        return {
            "number": 999,
            "state": "open",
            "draft": self.fault != "not_draft",
            "merged_at": None,
            "head": {"ref": BRANCH, "repo": {"full_name": REPO}},
            "base": {"ref": BASE, "sha": self.main_sha, "repo": {
                "full_name": "other/unknown" if self.fault == "wrong_repo" else REPO}},
        }


def simulate_approved_doc_draft(checkout_root, expected_main_sha, confirmation, client):
    """Exercise an immutable one-file transaction against a memory-only model.

    This does not accept an arbitrary adapter. A real implementation requires
    separate review and explicit authorization before App write access.
    """
    if type(client) is not InMemoryDraftClient:
        raise PermissionError("somente simulador em memoria e autorizado nesta fase")
    if confirmation != CONFIRMATION:
        raise PermissionError("simulacao QA nao confirmada")
    sha = validate_sha(expected_main_sha)
    proof = preview_doc_candidate(checkout_root)
    if (proof.get("status") != "docs_candidate_review_only"
            or proof.get("patch_id") != PATCH_ID
            or proof.get("target") != TARGET
            or proof.get("source_blob_sha1") != SOURCE_BLOB_SHA1
            or proof.get("sandbox_rollback_verified") is not True
            or proof.get("remote_writes") != 0
            or proof.get("production_access") is not False):
        raise ValueError("prova da receita documental nao confiavel")
    source = _pinned_source(checkout_root)
    changed = patch_static_source(source)
    if (proof.get("patched_sha256") != __import__("hashlib").sha256(
            changed.encode("utf-8")).hexdigest()):
        raise ValueError("patch documental nao corresponde ao diff fixado")
    _snapshot(client.live(), sha, branch_exists=False)
    _checked_file(client.base_document(), source, SOURCE_BLOB_SHA1)
    # Nothing may mutate a branch until BOTH main and the base file match.
    _snapshot(client.live(), sha, branch_exists=False)
    created = client.create_branch(BRANCH, sha)
    if created != {"ref": "refs/heads/" + BRANCH, "sha": sha}:
        raise ValueError("branch criada com identificador inesperado")
    # Failure after branch creation is left for human inspection: no retry,
    # force push, cleanup, or destructive compensation.
    _snapshot(client.live(), sha, branch_exists=True)
    _checked_file(client.branch_document(), source, SOURCE_BLOB_SHA1)
    reply = client.write_document(BRANCH, TARGET, SOURCE_BLOB_SHA1, changed)
    changed_blob = _git_blob_sha(changed.encode("utf-8"))
    if (type(reply) is not dict
            or reply != {"path": TARGET, "sha": changed_blob,
                         "commit_sha": "d" * 40}):
        raise ValueError("resposta da escrita simulada nao corresponde ao patch")
    _snapshot(client.live(), sha, branch_exists=True)
    _checked_file(client.branch_document(), changed, changed_blob)
    compared = client.compare(sha, BRANCH)
    if compared != {
        "ahead_by": 1, "behind_by": 0,
        "files": [{"filename": TARGET, "status": "modified"}],
    }:
        raise ValueError("diff de branches contem arquivo extra ou desvio")
    # A final main/PR check immediately precedes PR creation; a later race
    # is still possible in a real system and must be handled fail-closed.
    _snapshot(client.live(), sha, branch_exists=True)
    pr = client.create_pr(BRANCH, BASE, TITLE, BODY_PREFIX + sha)
    if (type(pr) is not dict or set(pr) != {
            "number", "state", "draft", "merged_at", "head", "base"}
            or type(pr["number"]) is not int or pr["number"] < 1
            or pr["state"] != "open" or pr["draft"] is not True
            or pr["merged_at"] is not None or pr["head"] != {
                "ref": BRANCH, "repo": {"full_name": REPO}}
            or pr["base"] != {
                "ref": BASE, "sha": sha, "repo": {"full_name": REPO}}):
        raise ValueError("PR simulada nao esta em rascunho seguro")
    return {
        "status": "simulated_draft_created_requires_human_review",
        "repository": REPO,
        "base_sha": sha,
        "branch": BRANCH,
        "target": TARGET,
        "patch_id": PATCH_ID,
        "draft": True,
        "merged": False,
        "simulated_branch_writes": 2,
        "simulated_pull_requests_created": 1,
        "remote_writes": 0,
        "actual_pull_requests_created": 0,
        "production_access": False,
    }
