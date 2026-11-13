#!/usr/bin/env python3
"""GitHub App QA document adapter: authenticated GET preflight, WRITE PLANS ONLY.

Never send a POST/PUT/PATCH/DELETE: this module has no mutating transport.
It is not invoked by a privileged Actions workflow, has no executable CLI,
and does not load secrets. A later, separately approved change is required
to implement any remote write.
"""
import base64
import binascii
import hashlib
import json
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from scripts.ci_quality_report import NoRedirect, REPO, validate_sha
from scripts.ci_autofix_doc_candidate import (
    TARGET, PATCH_ID, SOURCE_BLOB_SHA1, _git_blob_sha,
    _pinned_source, patch_static_source, preview_doc_candidate,
)
from scripts.ci_autofix_doc_draft_executor import (
    BASE, BODY_PREFIX, BRANCH, TITLE,
)

ROOT = "https://api.github.com/repos/" + REPO
REPO_SLUG = REPO.rsplit("/", 1)[-1]
OWNER = REPO.split("/", 1)[0]
GET_INSTALLATION = "/installation/repositories?per_page=2"
GET_MAIN = "/branches/main"
GET_BRANCH = "/git/ref/heads/" + BRANCH
GET_PRS = (
    "/pulls?state=all&head=" + OWNER + ":" + BRANCH
    + "&base=" + BASE + "&per_page=5"
)
GET_BASE_FILE = "/contents/" + TARGET + "?ref=" + BASE
ALLOWED_GET = frozenset((
    GET_INSTALLATION, GET_MAIN, GET_BRANCH, GET_PRS, GET_BASE_FILE,
))
MAX_REPLY = 250_000
MAX_PAYLOAD = 32_000
WRITE_MESSAGE = "docs(qa): atualizar instrucao historica de integracao"
BRANCH_WRITE_PATH = "/git/refs"
FILE_WRITE_PATH = "/contents/" + TARGET
PR_WRITE_PATH = "/pulls"
# The three descriptors are DATA ONLY; they are never given to a sender here.
INTENT_PATHS = frozenset((
    ("POST", BRANCH_WRITE_PATH),
    ("PUT", FILE_WRITE_PATH),
    ("POST", PR_WRITE_PATH),
))


def _expect_keys(value, keys):
    if type(value) is not dict or not keys.issubset(value):
        raise ValueError("JSON GitHub fora do contrato")


def _decode_content(payload):
    """Decode a bounded GitHub Contents API response and prove Git blob SHA."""
    _expect_keys(payload, {"sha", "encoding", "content", "type", "path"})
    if (payload["encoding"] != "base64" or payload["type"] != "file"
            or payload["path"] != TARGET
            or type(payload["sha"]) is not str
            or type(payload["content"]) is not str):
        raise ValueError("conteudo GitHub nao corresponde ao arquivo permitido")
    clean = "".join(payload["content"].split())
    if len(clean) > 28_000:
        raise ValueError("arquivo base64 acima do limite")
    try:
        data = base64.b64decode(clean, validate=True)
        source = data.decode("utf-8")
    except (UnicodeDecodeError, ValueError, binascii.Error) as exc:
        raise ValueError("arquivo GitHub nao e base64 UTF-8 valido") from exc
    if len(data) > 20_000 or _git_blob_sha(data) != payload["sha"]:
        raise ValueError("Git blob SHA nao coincide com os bytes")
    return payload["sha"], source


class DocGitHubAppReader:
    """GET-only fixed-endpoint client, using a separately supplied token.

    No URL, repository name, branch, HTTP method or request body is accepted
    from logs, artifacts, users or PR descriptions.
    """

    def __init__(self, token, *, opener=None):
        if type(token) is not str or not token or len(token) > 4096:
            raise PermissionError("token temporario de leitura ausente")
        self._token = token
        self._opener = build_opener(NoRedirect).open if opener is None else opener

    def _get(self, path, *, absent_ok=False):
        if path not in ALLOWED_GET:
            raise PermissionError("rota GitHub nao autorizada")
        if absent_ok and path != GET_BRANCH:
            raise PermissionError("404 so e esperado na referencia QA")
        # Installation scope is at /installation, not /repos/{owner}/{repo}.
        host = "https://api.github.com" if path == GET_INSTALLATION else ROOT
        req = Request(host + path, headers={
            "Authorization": "Bearer " + self._token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }, method="GET")
        try:
            with self._opener(req, timeout=20) as response:
                # Redirect handlers must not be able to turn an unusual
                # success-like response into a trusted 200 JSON payload.
                status = getattr(response, "status", 200)
                if status != 200:
                    raise ValueError("resposta HTTP de GitHub nao foi 200")
                # Avoid trusting content-length, which may be absent.
                body = response.read(MAX_REPLY + 1)
        except HTTPError as exc:
            status = exc.code
            exc.close()
            if absent_ok and status == 404:
                return None
            # Do not echo exception or response: can contain untrusted data.
            raise ValueError("consulta GitHub negada ou indisponivel") from None
        if len(body) > MAX_REPLY:
            raise ValueError("resposta GitHub excedeu limite")
        try:
            return json.loads(body)
        except (UnicodeDecodeError, ValueError) as exc:
            raise ValueError("resposta GitHub JSON invalida") from exc

    def confirm_only_repository(self):
        data = self._get(GET_INSTALLATION)
        _expect_keys(data, {"total_count", "repositories"})
        listed = data["repositories"]
        if (type(data["total_count"]) is not int
                or data["total_count"] != 1
                or type(listed) is not list or len(listed) != 1
                or type(listed[0]) is not dict
                or listed[0].get("full_name") != REPO):
            raise ValueError("token GitHub App nao esta limitado ao repositorio QA")

    def fetch_snapshot(self):
        main = self._get(GET_MAIN)
        _expect_keys(main, {"commit"})
        _expect_keys(main["commit"], {"sha"})
        current_sha = validate_sha(main["commit"]["sha"])
        # 404 only for exactly the fixed target branch, not other endpoints.
        branch = self._get(GET_BRANCH, absent_ok=True)
        if branch is not None:
            _expect_keys(branch, {"ref", "object"})
            if branch["ref"] != "refs/heads/" + BRANCH:
                raise ValueError("referencia QA divergente")
            _expect_keys(branch["object"], {"sha"})
            validate_sha(branch["object"]["sha"])
        prs = self._get(GET_PRS)
        if type(prs) is not list or len(prs) >= 5:
            # A full bounded page may conceal additional PRs.
            raise ValueError("historico de PRs potencialmente incompleto")
        for pr in prs:
            _expect_keys(pr, {"number", "head", "base"})
            _expect_keys(pr["head"], {"ref"})
            _expect_keys(pr["base"], {"ref"})
            if (type(pr["number"]) is not int
                    or pr["number"] < 1
                    or pr["head"]["ref"] != BRANCH
                    or pr["base"]["ref"] != BASE):
                raise ValueError("historico remoto de PRs inconsistente")
        return {
            "main_sha": current_sha,
            "branch_exists": branch is not None,
            "prior_pr_numbers": sorted({pr["number"] for pr in prs}),
        }

    def base_document(self):
        return _decode_content(self._get(GET_BASE_FILE))


def read_only_preflight(checkout_root, expected_main_sha, reader):
    """Verified, GET-only preflight; returns no token, URL or remote payload."""
    if type(reader) is not DocGitHubAppReader:
        raise PermissionError("cliente de leitura GitHub App nao autorizado")
    sha = validate_sha(expected_main_sha)
    proof = preview_doc_candidate(checkout_root)
    source = _pinned_source(checkout_root)
    patched = patch_static_source(source)
    if (proof.get("patch_id") != PATCH_ID
            or proof.get("target") != TARGET
            or proof.get("source_blob_sha1") != SOURCE_BLOB_SHA1
            or proof.get("remote_writes") != 0
            or proof.get("production_access") is not False
            or proof.get("patched_sha256") != hashlib.sha256(
                patched.encode("utf-8")).hexdigest()):
        raise ValueError("candidato QA nao passou na prova de integridade")
    reader.confirm_only_repository()
    before = reader.fetch_snapshot()
    if (before != {
            "main_sha": sha, "branch_exists": False,
            "prior_pr_numbers": []}):
        raise ValueError("SHA, branch ou historico de PR divergente")
    blob, remote_source = reader.base_document()
    if blob != SOURCE_BLOB_SHA1 or remote_source != source:
        raise ValueError("documento remoto divergiu do arquivo fixado")
    after = reader.fetch_snapshot()
    if after != before:
        raise ValueError("estado remoto mudou durante a pre-validacao")
    return {
        "status": "qa_document_authenticated_read_preflight_passed",
        "repository": REPO,
        "base_sha": sha,
        "target": TARGET,
        "source_blob_sha1": SOURCE_BLOB_SHA1,
        "patched_sha256": proof["patched_sha256"],
        "branch": BRANCH,
        "remote_writes": 0,
        "actual_pull_requests_created": 0,
        "eligible_to_write_without_new_approval": False,
        "requires_new_explicit_approval": True,
        "production_access": False,
    }


def _intent(method, path, payload):
    if (method, path) not in INTENT_PATHS or type(payload) is not dict:
        raise ValueError("operacao QA fora da allowlist")
    packed = json.dumps(payload, ensure_ascii=True, sort_keys=True)
    if len(packed.encode("utf-8")) > MAX_PAYLOAD:
        raise ValueError("payload de PR acima do limite")
    return {"method": method, "path": path, "payload": payload}


def draft_write_intents(checkout_root, expected_main_sha):
    """Build immutable-origin HTTP request DATA; never send these requests."""
    sha = validate_sha(expected_main_sha)
    proof = preview_doc_candidate(checkout_root)
    source = _pinned_source(checkout_root)
    new = patch_static_source(source)
    new_blob = _git_blob_sha(new.encode("utf-8"))
    if (proof["patched_sha256"] != hashlib.sha256(
            new.encode("utf-8")).hexdigest()
            or proof["source_blob_sha1"] != SOURCE_BLOB_SHA1):
        raise ValueError("plano de escrita documental nao corresponde ao patch")
    branch = _intent("POST", BRANCH_WRITE_PATH, {
        "ref": "refs/heads/" + BRANCH, "sha": sha,
    })
    file = _intent("PUT", FILE_WRITE_PATH, {
        "branch": BRANCH,
        "message": WRITE_MESSAGE,
        "sha": SOURCE_BLOB_SHA1,
        "content": base64.b64encode(new.encode("utf-8")).decode("ascii"),
    })
    pr = _intent("POST", PR_WRITE_PATH, {
        "head": BRANCH,
        "base": BASE,
        "draft": True,
        "maintainer_can_modify": False,
        "title": TITLE,
        "body": BODY_PREFIX + sha,
    })
    return {
        "mode": "frozen_intents_not_executable",
        "repository": REPO,
        "source_sha": sha,
        "source_blob_sha1": SOURCE_BLOB_SHA1,
        "patched_blob_sha1": new_blob,
        "intent_paths": [branch["path"], file["path"], pr["path"]],
        "intents": [branch, file, pr],
        "remote_writes": 0,
        "actual_pull_requests_created": 0,
        "requires_new_explicit_approval": True,
        "can_dispatch_requests": False,
    }
