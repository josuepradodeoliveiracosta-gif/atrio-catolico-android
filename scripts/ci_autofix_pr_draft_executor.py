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
    STATIC_BODY, STATIC_TITLE, fetch_live_pr_context,
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
    if set(plan) != set(exact) | {"source_sha", "preview_patch_sha256"}:
        raise ValueError("manifesto com campos adicionais ou ausentes")
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
            "verify_remote_patched_file_bytes",
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


def _validate_write_payload(method, path, payload):
    """Disallow arbitrary payloads even through the private HTTP writer."""
    if type(payload) is not dict:
        raise ValueError("payload GitHub invalido")
    if method == "POST" and path == "/git/refs":
        if (set(payload) != {"ref", "sha"}
                or payload.get("ref") != "refs/heads/" + BRANCH_NAME):
            raise ValueError("somente criacao da branch QA fixa")
        validate_sha(payload["sha"])
    elif method == "PUT" and path == "/contents/" + QA_TARGET:
        if (set(payload) != {"branch", "message", "sha", "content"}
                or payload.get("branch") != BRANCH_NAME
                or payload.get("message") != WRITE_MESSAGE):
            raise ValueError("arquivo/branch fora da politica QA")
        validate_sha(payload["sha"])
        if not isinstance(payload["content"], str):
            raise ValueError("conteudo do patch invalido")
        try:
            decoded = base64.b64decode(payload["content"], validate=True)
            source = decoded.decode("utf-8")
        except (ValueError, binascii.Error, UnicodeDecodeError) as error:
            raise ValueError("patch nao e base64 UTF-8 valido") from error
        if len(decoded) > MAX_SOURCE_BYTES:
            raise ValueError("patch ultrapassa limite QA")
        _, approved_patch, _ = _pinned_source(Path(__file__).resolve().parents[1])
        if source != approved_patch:
            raise ValueError("patch difere da alteracao estatica revisada")
    elif method == "POST" and path == "/pulls":
        prefix = STATIC_BODY + "\n\nSHA base revisado: "
        if (set(payload) != {"head", "base", "draft", "maintainer_can_modify",
                             "title", "body"}
                or payload.get("head") != BRANCH_NAME
                or payload.get("base") != BASE_BRANCH
                or payload.get("draft") is not True
                or payload.get("maintainer_can_modify") is not False
                or payload.get("title") != STATIC_TITLE
                or not isinstance(payload.get("body"), str)
                or not payload["body"].startswith(prefix)):
            raise ValueError("PR fora do contrato QA")
        validate_sha(payload["body"][len(prefix):])
    else:
        raise ValueError("operacao GitHub nao permitida")


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
        _validate_write_payload(method, path, payload)
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

    def get_pr(self, number):
        """Fetch only the numbered, existing PR; never create or update it."""
        if type(number) is not int or not 0 < number < 10 ** 12:
            raise ValueError("identificador de PR nao confiavel")
        from scripts.ci_autofix_pr_draft_plan import _get_api
        return _get_api("/pulls/" + str(number), self.token, self.opener)

    def create_pr(self, source_sha):
        return self._write("POST", "/pulls", {
            "head": BRANCH_NAME,
            "base": BASE_BRANCH,
            "draft": True,
            "maintainer_can_modify": False,
            "title": STATIC_TITLE,
            "body": STATIC_BODY + "\n\nSHA base revisado: " + source_sha,
        })


def verify_existing_qa_draft(checkout_root, client, expected_base_sha,
                             expected_head_sha, pr_number):
    """Reconcile an existing authorized QA draft with READ-ONLY GitHub calls.

    An existing branch/PR must never be treated as permission to retry a
    remote write. Fail closed if any ref, byte, diff, origin, or status drifts.
    This does not grant permission to merge, publish, or enable a writer.
    """
    base_sha = validate_sha(expected_base_sha)
    head_sha = validate_sha(expected_head_sha)
    if (base_sha == head_sha or type(pr_number) is not int
            or not 0 < pr_number < 10 ** 12):
        raise ValueError("SHAs ou identificador de PR invalidos")
    original, patched, proof = _pinned_source(checkout_root)
    context = client.live_context()
    if (not isinstance(context, dict)
            or context.get("main_sha") != base_sha
            or context.get("target_branch_exists") is not True
            or context.get("duplicate_pr_numbers") != [pr_number]):
        raise ValueError("contexto remoto nao corresponde a PR draft unica")
    remote = client.base_file()
    if (not isinstance(remote, dict)
            or remote.get("source") != original):
        raise ValueError("origem QA da main divergiu")
    branch = client.branch_ref()
    if (not isinstance(branch, dict)
            or branch.get("ref") != "refs/heads/" + BRANCH_NAME
            or not isinstance(branch.get("object"), dict)
            or branch["object"].get("sha") != head_sha):
        raise ValueError("HEAD de QA nao corresponde ao commit esperado")
    if client.branch_file() != patched:
        raise ValueError("patch remoto nao corresponde aos bytes aprovados")
    comparison = client.compare(base_sha)
    if (not isinstance(comparison, dict)
            or comparison.get("ahead_by") != 1
            or comparison.get("behind_by") != 0
            or type(comparison.get("files")) is not list
            or len(comparison["files"]) != 1
            or comparison["files"][0].get("filename") != QA_TARGET
            or comparison["files"][0].get("status") != "modified"):
        raise ValueError("diff remoto fora do unico arquivo QA autorizado")
    pr = client.get_pr(pr_number)
    if (not isinstance(pr, dict)
            or pr.get("number") != pr_number
            or type(pr.get("number")) is not int
            or pr.get("state") != "open"
            or pr.get("draft") is not True
            or pr.get("merged_at") is not None
            or not isinstance(pr.get("head"), dict)
            or not isinstance(pr.get("base"), dict)
            or pr["head"].get("ref") != BRANCH_NAME
            or pr["head"].get("sha") != head_sha
            or not isinstance(pr["head"].get("repo"), dict)
            or pr["head"]["repo"].get("full_name") != REPO
            or pr["base"].get("ref") != BASE_BRANCH
            or pr["base"].get("sha") != base_sha
            or not isinstance(pr["base"].get("repo"), dict)
            or pr["base"]["repo"].get("full_name") != REPO):
        raise ValueError("PR remota nao corresponde ao rascunho QA revisado")
    # Catch intervening branch moves, duplicate PRs and main updates.
    last = client.live_context()
    final_branch = client.branch_ref()
    if (not isinstance(last, dict)
            or last.get("main_sha") != base_sha
            or last.get("target_branch_exists") is not True
            or last.get("duplicate_pr_numbers") != [pr_number]
            or not isinstance(final_branch, dict)
            or final_branch.get("ref") != "refs/heads/" + BRANCH_NAME
            or not isinstance(final_branch.get("object"), dict)
            or final_branch["object"].get("sha") != head_sha):
        raise ValueError("estado remoto mudou durante verificacao; reavaliar")
    return {
        "status": "existing_qa_draft_verified_read_only",
        "repository": REPO,
        "pr_number": pr_number,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "branch": BRANCH_NAME,
        "draft": True,
        "only_file": QA_TARGET,
        "patch_sha256": proof["patched_sha256"],
        "remote_writes": 0,
        "automatic_merge_or_deploy": False,
        "human_review_required": True,
    }


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
    # Even after writing our branch, another actor could open a competing PR
    # or move main. Check the live state again immediately before creating PR.
    latest = client.live_context()
    if (not isinstance(latest, dict)
            or latest.get("main_sha") != source_sha
            or latest.get("target_branch_exists") is not True
            or latest.get("duplicate_pr_numbers") != []):
        raise ValueError("contexto remoto mudou; nao criar PR duplicada")
    pr = client.create_pr(source_sha)
    if (not isinstance(pr, dict) or pr.get("state") != "open"
            or pr.get("draft") is not True
            or type(pr.get("number")) is not int
            or not 0 < pr["number"] < 10 ** 12
            or pr.get("merged_at") is not None
            or not isinstance(pr.get("head"), dict)
            or not isinstance(pr.get("base"), dict)
            or not isinstance(pr["head"].get("repo"), dict)
            or not isinstance(pr["base"].get("repo"), dict)
            or pr["head"].get("ref") != BRANCH_NAME
            or pr["head"].get("sha") != commit_sha
            or pr["head"]["repo"].get("full_name") != REPO
            or pr["base"].get("ref") != BASE_BRANCH
            or pr["base"].get("sha") != source_sha
            or pr["base"]["repo"].get("full_name") != REPO):
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
