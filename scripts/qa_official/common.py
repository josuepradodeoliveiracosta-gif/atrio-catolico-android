"""Shared checks; no Firebase admin credentials and no content-writing API."""
import json
import re
import urllib.request

PROJECT = "atrio-catolico"
PACKAGE = "br.com.atriocatolico"
REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
UIDS = {name: f"qa_{name}_v19" for name in ("clara", "miguel", "lucia")}
ROOT = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def accounts(raw):
    data = json.loads(raw)
    require(isinstance(data, dict) and set(data) == set(UIDS), "invalid_bot_set")
    emails = []
    for name, entry in data.items():
        require(isinstance(entry, dict) and set(entry) == {"email", "password"}, "invalid_bot_fields")
        email, password = entry["email"], entry["password"]
        require(isinstance(email, str) and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email), "invalid_email")
        require(isinstance(password, str) and 16 <= len(password) <= 128
                and all(ord(c) >= 32 for c in password), "invalid_password")
        emails.append(email.lower())
    require(len(set(emails)) == 3, "duplicate_email")
    return data


def digest(value):
    value = value.replace(":", "").strip().lower()
    require(re.fullmatch(r"[0-9a-f]{64}", value), "invalid_sha256")
    return value


def session_title(session):
    require(re.fullmatch(r"[a-z0-9][a-z0-9_-]{7,39}", session), "invalid_session")
    return f"[SIMULACAO BOT DE TESTE] APK {session}"


def field(doc, name):
    item = doc.get("fields", {}).get(name, {})
    return item.get("stringValue", item.get("booleanValue"))


def request(url, *, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except Exception:
        # Response bodies / exception reprs may contain tokens or account data.
        raise RuntimeError("remote_request_failed") from None


class Oracle:
    """Sign in as the SAME three members; only read Firestore to verify UI work."""
    def __init__(self, api_key, bots):
        self.tokens, self.names = {}, {}
        for alias, bot in bots.items():
            result = request("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + api_key,
                             data={**bot, "returnSecureToken": True})
            require(result.get("localId") == UIDS[alias], "bot_uid_mismatch")
            self.tokens[alias] = result["idToken"]
            profile = self.get(alias, "profiles/" + UIDS[alias])
            name = field(profile, "displayName")
            require(isinstance(name, str) and "BOT DE TESTE" in name.upper(), "bot_not_labelled")
            self.names[alias] = name

    def get(self, alias, path):
        return request(ROOT + "/" + path, token=self.tokens[alias])

    def query(self, alias, collection, key, value, parent=""):
        query = {"from": [{"collectionId": collection}], "where": {"fieldFilter": {
            "field": {"fieldPath": key}, "op": "EQUAL", "value": {"stringValue": value}}}, "limit": 20}
        result = request(ROOT + ("/" + parent if parent else "") + ":runQuery",
                         data={"structuredQuery": query}, token=self.tokens[alias])
        return [item["document"] for item in result if "document" in item]


def validate_source(run, artifact):
    require(run.get("repository", {}).get("full_name") == REPO, "wrong_repository")
    require(run.get("path") == ".github/workflows/build-apk.yml", "wrong_build_workflow")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "build_not_successful")
    require(artifact.get("name") == "atrio-catolico-release-assinado" and not artifact.get("expired"), "invalid_artifact")
    require(artifact.get("workflow_run", {}).get("id") == run.get("id"), "artifact_run_mismatch")
