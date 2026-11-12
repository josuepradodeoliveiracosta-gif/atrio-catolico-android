#!/usr/bin/env python3
"""Manual-only, narrowly scoped GitHub draft-PR transaction for QA.

NOT wired to Actions and has NO execute CLI. The default CLI is a read-only
local preflight; production mutations and automatic merges are impossible.
The write-capable function requires explicit operator confirmation, a pinned
base SHA and a separately supplied, scoped GitHub client. Never run this
against a pull_request/workflow_run payload or with credentials from a PR.
"""
import argparse
import base64
import binascii
import json
from pathlib import Path
from urllib.request import Request, build_opener

from scripts.ci_quality_report import NoRedirect, REPO, validate_sha
from scripts.ci_autofix_handoff import read_json_bounded
from scripts.ci_autofix_qa_review import (
    QA_TARGET, QA_TARGET_SHA256, PATCH_ID, MAX_SOURCE_BYTES,
    apply_reviewed_patch, preview_real_qa_patch,
)
from scripts.ci_autofix_pr_draft_plan import (
    BASE_BRANCH, BRANCH_NAME, MAX_REMOTE_RESPONSE_BYTES,
    STATIC_BODY, STATIC_TITLE, draft_pr_plan, fetch_live_pr_context,
)
from scripts.ci_autofix_sandbox import read_pinned_qa_source, sha256

CONFIRMATION = "CREATE_ATRIO_QA_DRAFT_PR_ONLY"
WRITE_MESSAGE = "fix(qa): distinguir checks de PR ausentes em push"
MAX_BLOB_BYTES = 24_000
ALLOWED_POST_PATHS = frozenset(("/git/refs", "/pulls"))
ALLOWED_PUT_PATHS = frozenset(("/contents/" + QA_TARGET,))


def _pinned_source(checkout_root):
    source = read_pinned_qa_source(
        checkout_root, QA_TARGET, frozenset((QA_TARGET,)),
        QA_TARGET_SHA256, MAX_SOURCE_BYTES)
    changed = apply_reviewed_patch(source)
    proof = preview_real_qa_patch(checkout_root)
    if (sha256(changed) != proof["patched_sha256"]
            or proof["sandbox_rollback_verified"] is not True
            or proof["checkout_files_changed"] != 0):
        raise ValueError("patch QA sem prova valida em sandbox")
    return source, changed, proof


def validate_draft_manifest(plan, checkout_root):
    """Reject any unreviewed fields; a manifest never grants authority."""
    if not isinstance(plan, dict):
        raise ValueError("manifesto invalido")
    sha = validate_sha(plan.get("source_sha"))
    exact = {
        "schema_version": 1,
        "mode": "read_only_draft_pr_planning",
        "repository": REPO,
        "status": "draft_pr_descriptor_ready_for_review",
        "patch_id": PATCH_ID,
        "target_path": QA_TARGET,
        "base_branch": BASE_BRANCH,
        "head_branch": BRANCH_NAME,
        "draft_pr_title": STATIC_TITLE,
        "draft_pr_body": STATIC_BODY + "\n\nSHA base revisado: " + sha,
        "duplicate_pr_numbers": [],
        "target_branch_absence_checked": True,
        "live_main_sha_checked": True,
        "candidate_patch_verified": True,
        "draft_pr_created": False,
        "draft_only": True,
        "eligible_for_automatic_remote_write": False,
        "race_window_remains": True,
        "premerge_ci_validation": "required_not_yet_verified",
        "changes_to_checkout": 0,
        "remote_writes": 0,
        "merges_or_deploys": 0,
        "production_access": False,
        "human_approval_required_before_merge": True,
        "current_automation_percent_measured": None,
        "preview_source_sha256": QA_TARGET_SHA256,
    }
    for key, expected in exact.items():
        if key not in plan or type(plan[key]) is not type(expected) or plan[key] != expected:
            raise ValueError("manifesto de PR adulterado: " + key)
    _, new_source, proof = _pinned_source(checkout_root)
    if (not isinstance(plan.get("preview_patch_sha256"), str)
            or plan["preview_patch_sha256"] != sha256(new_source)
            or plan["preview_patch_sha256"] != proof["patched_sha256"]):
        raise ValueError("hash de patch nao corresponde a fonte revisada")
    return sha, new_source


def draft_transaction_preview(plan, checkout_root):
    """Bounded, offline transaction preview; no token or GitHub API access."""
    sha, changed = validate_draft_manifest(plan, checkout_root)
    return {
        "mode": "offline_writer_preflight_only",
        "repository": REPO,
        "expected_main_sha": sha,
        "branch": BRANCH_NAME,
        "base": BASE_BRANCH,
        "file": QA_TARGET,
        "source_sha256": QA_TARGET_SHA256,
        "patch_sha256": sha256(changed),
        "operations_if_explicitly_approved": [
            "recheck_main_and_branch",
            "verify_base_file_blob",
            "create_new_qa_branch_without_force",
            "write_one_pinned_qa_file_with_blob_sha",
            "verify_single_file_diff",
            "open_draft_pr_no_merge",
        ],
        "remote_writes": 0,
        "draft_pr_created": False,
        "execute_cli_available": False,
        "current_automation_percent_measured": None,
    }


def _validate_live_context(context, sha):
    if not isinstance(context, dict):
        raise ValueError("contexto GitHub indisponivel")
    current = validate_sha(context.get("main_sha"))
    if current != sha:
        raise ValueError("main mudou: proibido usar evidencia antiga")
    if (context.get("target_branch_exists") is not False
            or context.get("duplicate_pr_numbers") != []):
        raise ValueError("branch/PR ja existente: nao sobrescrever")
    return current


class GitHubDraftClient:
    """Exact GitHub REST endpoints only, no redirects, no user supplied URL.

    Instantiate only inside an independently trusted, explicitly authorized
    manual environment with Contents:write and PullRequests:write. Never
    instantiate this client in CI report, pull_request or workflow_run jobs.
    """
    def __init__(self, token, opener=None):
        if not isinstance(token, str) or not token:
            raise ValueError("token GitHub restrito ausente")
        self.token = token
        self.opener = opener or build_opener(NoRedirect).open

    def _write(self, method, path, payload):
        allowed = ALLOWED_POST_PATHS if method == "POST" else ALLOWED_PUT_PATHS
        if method not in ("POST", "PUT") or path not in allowed:
            raise ValueError("operacao remota fora da allowlist")
        data = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
        if len(data) > MAX_BLOB_BYTES:
            raise ValueError("payload remoto acima do limite")
        req = Request("https://api.github.com/repos/" + REPO + path,
                      data=data, method=method, headers={
                          "Authorization": "Bearer " + self.token,
                          "Accept": "application/vnd.github+json",
                          "Content-Type": "application/json",
                          "X-GitHub-Api-Version": "2022-11-28",
                      })
        with self.opener(req, timeout=20) as response:
            raw = response.read(MAX_REMOTE_RESPONSE_BYTES + 1)
        if len(raw) > MAX_REMOTE_RESPONSE_BYTES:
            raise ValueError("resposta remota grande demais")
        return json.loads(raw)

    def live_context(self):
        return fetch_live_pr_context(self.token, self.opener)

    def base_file(self):
        from scripts.ci_autofix_pr_draft_plan import _get_api
        payload = _get_api("/contents/" + QA_TARGET + "?ref=main",
                           self.token, self.opener)
        if (not isinstance(payload, dict)
                or payload.get("type") != "file"
                or payload.get("path") != QA_TARGET
                or not isinstance(payload.get("sha"), str)
                or not isinstance(payload.get("content"), str)
                or payload.get("encoding") != "base64"):
            raise ValueError("resposta de arquivo GitHub invalida")
        try:
            body = base64.b64decode(payload["content"], validate=False)
        except (ValueError, binascii.Error) as error:
            raise ValueError("arquivo GitHub sem base64 valido") from error
        if len(body) > MAX_SOURCE_BYTES or sha256(body.decode("utf-8")) != QA_TARGET_SHA256:
            raise ValueError("conteudo remoto mudou desde revisao")
        return {"sha": payload["sha"], "source": body.decode("utf-8")}

    def branch_file(self):
        """Verify final QA file bytes from the new branch, not only API status."""
        from scripts.ci_autofix_pr_draft_plan import _get_api
        payload = _get_api("/contents/" + QA_TARGET + "?ref=" + BRANCH_NAME,
                           self.token, self.opener)
        if (not isinstance(payload, dict)
                or payload.get("type") != "file"
                or payload.get("path") != QA_TARGET
                or payload.get("encoding") != "base64"
                or not isinstance(payload.get("content"), str)):
            raise ValueError("arquivo remoto na branch invalido")
        try:
            data = base64.b64decode(payload["content"], validate=False)
        except (ValueError, binascii.Error) as error:
            raise ValueError("base64 invalido do arquivo da branch") from error
        if len(data) > MAX_SOURCE_BYTES:
            raise ValueError("arquivo remoto QA fora do limite")
        return data.decode("utf-8")

    def create_branch(self, source_sha):
        return self._write("POST", "/git/refs", {
            "ref": "refs/heads/" + BRANCH_NAME, "sha": source_sha})

    def branch_ref(self):
        from scripts.ci_autofix_pr_draft_plan import _get_api
        return _get_api("/git/ref/heads/" + BRANCH_NAME,
                        self.token, self.opener)

    def patch_file(self, blob_sha, patched):
        return self._write("PUT", "/contents/" + QA_TARGET, {
            "branch": BRANCH_NAME,
            "message": WRITE_MESSAGE,
            "sha": blob_sha,
            "content": base64.b64encode(patched.encode("utf-8")).decode("ascii"),
        })

    def compare(self, base_sha):
        from scripts.ci_autofix_pr_draft_plan import _get_api
        return _get_api("/compare/" + base_sha + "..." + BRANCH_NAME,
                        self.token, self.opener)

    def create_pr(self, source_sha):
        return self._write("POST", "/pulls", {
            "head": BRANCH_NAME,
            "base": BASE_BRANCH,
            "draft": True,
            "maintainer_can_modify": False,
            "title": STATIC_TITLE,
            "body": STATIC_BODY + "\n\nSHA base revisado: " + source_sha,
        })


def execute_manually_approved_draft(plan, checkout_root, client,
                                    approved_base_sha, confirmation):
    """Only manual opt-in can perform writes; NEVER called by the CLI.

    Deliberately no automatic cleanup after a partial write: deletion can be
    destructive. Fail closed and leave the temporary branch for human review.
    """
    if confirmation != CONFIRMATION:
        raise PermissionError("aprovacao explicita de criacao draft ausente")
    source_sha, patched = validate_draft_manifest(plan, checkout_root)
    if approved_base_sha != source_sha:
        raise PermissionError("SHA revisado pelo operador nao corresponde")
    _validate_live_context(client.live_context(), source_sha)
    remote = client.base_file()
    original = read_pinned_qa_source(
        checkout_root, QA_TARGET, frozenset((QA_TARGET,)),
        QA_TARGET_SHA256, MAX_SOURCE_BYTES)
    if remote["source"] != original:
        raise ValueError("arquivo main remoto difere do QA revisado")
    if not isinstance(remote.get("sha"), str):
        raise ValueError("blob SHA Git ausente")
    validate_sha(remote["sha"])
    # Second preflight immediately before non-forced creation.
    _validate_live_context(client.live_context(), source_sha)
    created = client.create_branch(source_sha)
    if (not isinstance(created, dict)
            or created.get("ref") != "refs/heads/" + BRANCH_NAME
            or not isinstance(created.get("object"), dict)
            or created["object"].get("sha") != source_sha):
        raise ValueError("branch criada com retorno inesperado; revisar manualmente")
    branch = client.branch_ref()
    if (not isinstance(branch, dict)
            or branch.get("ref") != "refs/heads/" + BRANCH_NAME
            or not isinstance(branch.get("object"), dict)
            or branch["object"].get("sha") != source_sha):
        raise ValueError("branch remota divergiu; nenhuma escrita adicional")
    if client.live_context().get("main_sha") != source_sha:
        raise ValueError("main mudou apos criar branch; revisar manualmente")
    update = client.patch_file(remote["sha"], patched)
    if (not isinstance(update, dict) or not isinstance(update.get("commit"), dict)
            or not isinstance(update.get("content"), dict)
            or update["content"].get("path") != QA_TARGET):
        raise ValueError("commit remoto inesperado; revisar manualmente")
    commit_sha = validate_sha(update["commit"].get("sha"))
    if client.branch_file() != patched:
        raise ValueError("conteudo da branch diverge do patch revisado; sem PR")
    comparison = client.compare(source_sha)
    if (not isinstance(comparison, dict)
            or comparison.get("ahead_by") != 1
            or comparison.get("behind_by") != 0
            or not isinstance(comparison.get("files"), list)
            or len(comparison["files"]) != 1
            or comparison["files"][0].get("filename") != QA_TARGET
            or comparison["files"][0].get("status") != "modified"):
        raise ValueError("diff remoto fora do arquivo autorizado; sem PR")
    branch = client.branch_ref()
    if (not isinstance(branch, dict)
            or branch.get("object", {}).get("sha") != commit_sha):
        raise ValueError("HEAD da branch nao corresponde ao commit revisado")
    if client.live_context().get("main_sha") != source_sha:
        raise ValueError("main mudou; nao criar PR contra base antiga")
    pr = client.create_pr(source_sha)
    if (not isinstance(pr, dict) or pr.get("state") != "open"
            or pr.get("draft") is not True
            or type(pr.get("number")) is not int
            or not 0 < pr["number"] < 10 ** 12
            or pr.get("merged_at") is not None
            or pr.get("head", {}).get("ref") != BRANCH_NAME
            or pr.get("base", {}).get("ref") != BASE_BRANCH):
        raise ValueError("PR criada com retorno inesperado; verificar manualmente")
    return {
        "status": "draft_pr_created_review_required",
        "number": pr["number"], "branch": BRANCH_NAME,
        "base": BASE_BRANCH, "head_sha": commit_sha,
        "draft": True, "merged": False,
        "requires_human_review": True,
        "automatic_merge_or_deploy": False,
    }


def main():
    """Offline-only CLI. There is intentionally no --execute option."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--json", required=True)
    args = parser.parse_args()
    preview = draft_transaction_preview(
        read_json_bounded(args.manifest), args.checkout_root)
    Path(args.json).write_text(
        json.dumps(preview, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    print("PR draft: preflight offline validado; nenhuma escrita remota")


if __name__ == "__main__":
    main()
