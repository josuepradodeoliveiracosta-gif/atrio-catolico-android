#!/usr/bin/env python3
"""Manually gated GitHub App QA-document draft transaction.

This is an UNWIRED library, not a job, CLI, listener or automatic writer.
Do not expose it to pull_request/workflow_run events or broad-scope tokens.
The caller must separately receive the owner's specific execution approval.
"""
import json
from urllib.error import HTTPError
from urllib.request import Request

from scripts.ci_quality_report import REPO, validate_sha
from scripts.ci_autofix_doc_candidate import (
    TARGET, SOURCE_BLOB_SHA1, _git_blob_sha, _pinned_source,
    patch_static_source,
)
from scripts.ci_autofix_doc_draft_executor import BASE, BRANCH
from scripts.ci_autofix_doc_github_adapter import (
    ROOT, MAX_REPLY, MAX_PAYLOAD, GET_BRANCH,
    DocGitHubAppReader, read_only_preflight, draft_write_intents,
    _decode_content,
)

APPROVAL = "CREATE_ONE_ATRIO_DOCUMENT_QA_DRAFT_ONLY"
BRANCH_DOCUMENT = "/contents/" + TARGET + "?ref=" + BRANCH
# The compare route is built exclusively from a validated full commit SHA.
COMPARE_SUFFIX = "..." + BRANCH
_REQ_STEPS = (("POST", "/git/refs", 201),
              ("PUT", "/contents/" + TARGET, 200),
              ("POST", "/pulls", 201))
_PRIVATE_GATE = object()


def _exact_snapshot(data, sha, *, branch, prs):
    if (type(data) is not dict or data != {
            "main_sha": sha, "branch_exists": branch,
            "prior_pr_numbers": prs}):
        raise ValueError("main, branch ou PR historica divergiu")


def _branch_commit(data, expected):
    if (type(data) is not dict
            or data.get("ref") != "refs/heads/" + BRANCH
            or type(data.get("object")) is not dict
            or data["object"].get("sha") != expected):
        raise ValueError("referencia QA nao coincide com commit verificado")


def _single_doc_compare(payload):
    if (type(payload) is not dict
            or payload.get("status") != "ahead"
            or type(payload.get("ahead_by")) is not int
            or payload["ahead_by"] != 1
            or type(payload.get("behind_by")) is not int
            or payload["behind_by"] != 0
            or type(payload.get("total_commits")) is not int
            or payload["total_commits"] != 1
            or type(payload.get("files")) is not list
            or len(payload["files"]) != 1
            or type(payload["files"][0]) is not dict
            or payload["files"][0].get("filename") != TARGET
            or payload["files"][0].get("status") != "modified"):
        raise ValueError("diff QA nao e somente o documento aprovado")


def _reviewed_pr(payload, sha, commit_sha, *, number=None):
    if type(payload) is not dict:
        raise ValueError("resposta de PR nao e objeto")
    n = payload.get("number")
    if (type(n) is not int or not 0 < n < 10**12
            or (number is not None and n != number)
            or payload.get("state") != "open"
            or payload.get("draft") is not True
            or payload.get("merged_at") is not None):
        raise ValueError("PR nao esta em rascunho seguro")
    head, base = payload.get("head"), payload.get("base")
    if type(head) is not dict or type(base) is not dict:
        raise ValueError("repositorio da PR nao verificavel")
    for item, branch, commit in ((head, BRANCH, commit_sha),
                                 (base, BASE, sha)):
        if (item.get("ref") != branch or item.get("sha") != commit
                or type(item.get("repo")) is not dict
                or item["repo"].get("full_name") != REPO):
            raise ValueError("origem ou commit da PR nao autorizado")
    # A GitHub API response may include many legitimate extra fields.
    return n


class DocumentDraftAppTransport:
    """Fixed-host GitHub App client; no token lookup, CLI or workflow hook.

    A token is supplied explicitly by a trusted caller. The constructor
    stores it privately; this library never reads environment variables.
    """

    def __init__(self, token, *, opener=None):
        reader = DocGitHubAppReader(token, opener=opener)
        self.__token = token
        self.__opener = reader._opener

    def reader(self):
        return DocGitHubAppReader(self.__token, opener=self.__opener)

    def _request(self, method, path, payload=None, *, accepted=(200,), gate=None):
        if gate is not _PRIVATE_GATE:
            raise PermissionError("transporte GitHub sem porta de controle")
        if method == "GET":
            if payload is not None:
                raise PermissionError("GET nao aceita corpo")
            if path not in (GET_BRANCH, BRANCH_DOCUMENT):
                if path.startswith("/compare/") and path.endswith(COMPARE_SUFFIX):
                    validate_sha(path[len("/compare/"):-len(COMPARE_SUFFIX)])
                elif path.startswith("/pulls/"):
                    number = path[len("/pulls/"):]
                    if not number.isascii() or not number.isdecimal():
                        raise PermissionError("numero da PR invalido")
                    n = int(number)
                    if not 0 < n < 10**12 or str(n) != number:
                        raise PermissionError("numero da PR nao permitido")
                else:
                    raise PermissionError("rota GET fora da allowlist")
        elif method in ("POST", "PUT"):
            if payload is None or (method, path) not in {
                    (item[0], item[1]) for item in _REQ_STEPS}:
                raise PermissionError("escrita fora das 3 rotas fixas")
        else:
            raise PermissionError("metodo HTTP proibido")
        data = None
        if payload is not None:
            data = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
            if len(data) > MAX_PAYLOAD:
                raise ValueError("corpo GitHub acima do limite")
        headers = {
            "Authorization": "Bearer " + self.__token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = Request(ROOT + path, headers=headers, data=data, method=method)
        try:
            with self.__opener(req, timeout=20) as resp:
                if getattr(resp, "status", None) not in accepted:
                    raise ValueError("status GitHub inesperado")
                raw = resp.read(MAX_REPLY + 1)
        except HTTPError as exc:
            exc.close()
            raise ValueError("transacao GitHub recusada: parar sem repetir") from None
        except OSError:
            raise ValueError("transacao GitHub indisponivel: parar sem repetir") from None
        if len(raw) > MAX_REPLY:
            raise ValueError("resposta GitHub grande demais")
        try:
            return json.loads(raw)
        except (UnicodeError, ValueError):
            raise ValueError("resposta GitHub JSON invalida") from None

    def _read(self, path, expected_sha):
        sha = validate_sha(expected_sha)
        allowed = {
            GET_BRANCH,
            BRANCH_DOCUMENT,
            "/compare/" + sha + COMPARE_SUFFIX,
        }
        if path not in allowed:
            raise PermissionError("leitura fora das rotas QA fixas")
        return self._request("GET", path, gate=_PRIVATE_GATE)

    def _get_pr(self, number):
        if type(number) is not int or not 0 < number < 10**12:
            raise ValueError("numero PR nao confiavel")
        return self._request("GET", "/pulls/" + str(number),
                             gate=_PRIVATE_GATE)

    def _send_reviewed(self, plan, index, *, gate):
        # This method cannot be used without the transaction's internal gate.
        if gate is not _PRIVATE_GATE:
            raise PermissionError("escrita sem porta de controle interna")
        if (type(plan) is not dict
                or plan.get("mode") != "frozen_intents_not_executable"
                or plan.get("can_dispatch_requests") is not False
                or plan.get("requires_new_explicit_approval") is not True
                or plan.get("repository") != REPO
                or type(index) is not int or index not in (0, 1, 2)
                or type(plan.get("intents")) is not list
                or len(plan["intents"]) != 3):
            raise ValueError("plano QA nao confiavel")
        expected_method, expected_path, expected_status = _REQ_STEPS[index]
        record = plan["intents"][index]
        if (type(record) is not dict
                or set(record) != {"method", "path", "payload"}
                or record["method"] != expected_method
                or record["path"] != expected_path
                or type(record["payload"]) is not dict):
            raise ValueError("intencao de escrita nao corresponde a receita")
        return self._request(expected_method, expected_path, record["payload"],
                             accepted=(expected_status,) if index != 1 else (200, 201),
                             gate=_PRIVATE_GATE)


def execute_manually_authorized_document_draft(
        checkout_root, expected_main_sha, confirmation, client):
    """Make precisely ONE branch, ONE document commit and ONE draft PR.

    NOT invoked by any CLI or Action. Requires operator's separate, specific
    approval to supply the token and confirmation in a trusted environment.
    There is no retry, forced update, delete, compensation or merge.
    """
    if type(client) is not DocumentDraftAppTransport:
        raise PermissionError("somente transporte GitHub App especifico")
    if confirmation != APPROVAL:
        raise PermissionError("autorizacao de escrita documental ausente")
    sha = validate_sha(expected_main_sha)
    # The read preflight uses the exact existing GET-only class.
    initial = read_only_preflight(checkout_root, sha, client.reader())
    if (initial.get("eligible_to_write_without_new_approval") is not False
            or initial.get("remote_writes") != 0
            or initial.get("base_sha") != sha):
        raise ValueError("preflight QA nao autoriza escrita")
    plan = draft_write_intents(checkout_root, sha)
    source = _pinned_source(checkout_root)
    patched = patch_static_source(source)
    changed_blob = _git_blob_sha(patched.encode("utf-8"))
    if (plan["source_sha"] != sha
            or plan["source_blob_sha1"] != SOURCE_BLOB_SHA1
            or plan["patched_blob_sha1"] != changed_blob
            or plan["remote_writes"] != 0
            or plan["actual_pull_requests_created"] != 0):
        raise ValueError("plano QA nao corresponde ao arquivo fixo")
    # Recheck HEAD and lifetime PR history immediately before the first write.
    _exact_snapshot(client.reader().fetch_snapshot(), sha, branch=False, prs=[])

    # WRITE 1: create a NEW, fixed QA branch from the verified main.
    branch = client._send_reviewed(plan, 0, gate=_PRIVATE_GATE)
    _branch_commit(branch, sha)
    _exact_snapshot(client.reader().fetch_snapshot(), sha, branch=True, prs=[])
    _branch_commit(client._read(GET_BRANCH, sha), sha)
    source_blob, branch_source = _decode_content(
        client._read(BRANCH_DOCUMENT, sha))
    if (source_blob != SOURCE_BLOB_SHA1 or branch_source != source):
        raise ValueError("branch criada nao contem fonte documental fixa")

    # WRITE 2: update just the pinned file via GitHub Contents with old blob SHA.
    result = client._send_reviewed(plan, 1, gate=_PRIVATE_GATE)
    if (type(result) is not dict
            or type(result.get("content")) is not dict
            or type(result.get("commit")) is not dict
            or result["content"].get("sha") != changed_blob
            or result["content"].get("path") != TARGET):
        raise ValueError("GitHub nao confirmou conteudo exato")
    commit_sha = validate_sha(result["commit"].get("sha"))
    if commit_sha == sha:
        raise ValueError("commit QA nao foi criado")
    _exact_snapshot(client.reader().fetch_snapshot(), sha, branch=True, prs=[])
    _branch_commit(client._read(GET_BRANCH, sha), commit_sha)
    now_blob, now_doc = _decode_content(client._read(BRANCH_DOCUMENT, sha))
    if now_blob != changed_blob or now_doc != patched:
        raise ValueError("conteudo escrito difere da receita revisada")
    _single_doc_compare(
        client._read("/compare/" + sha + COMPARE_SUFFIX, sha))

    # Before WRITE 3: confirm HEAD, no competing PR and exact branch tip.
    _exact_snapshot(client.reader().fetch_snapshot(), sha, branch=True, prs=[])
    _branch_commit(client._read(GET_BRANCH, sha), commit_sha)

    # WRITE 3: one DRAFT PR, never merged or made ready automatically.
    created = client._send_reviewed(plan, 2, gate=_PRIVATE_GATE)
    number = _reviewed_pr(created, sha, commit_sha)
    _reviewed_pr(client._get_pr(number), sha, commit_sha, number=number)
    _exact_snapshot(client.reader().fetch_snapshot(), sha,
                    branch=True, prs=[number])
    _branch_commit(client._read(GET_BRANCH, sha), commit_sha)
    return {
        "status": "real_document_draft_created_requires_human_review",
        "repository": REPO,
        "pr_number": number,
        "main_sha": sha,
        "branch": BRANCH,
        "branch_commit_sha": commit_sha,
        "only_file": TARGET,
        "source_blob_sha1": SOURCE_BLOB_SHA1,
        "patched_blob_sha1": changed_blob,
        "draft": True,
        "remote_writes": 3,
        "merged": False,
        "production_access": False,
        "requires_human_review_before_merge": True,
    }
