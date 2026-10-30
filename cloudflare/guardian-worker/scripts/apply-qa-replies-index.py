#!/usr/bin/env python3
"""Add only the missing replies.createdAt COLLECTION_GROUP index to QA.

No dependencies beyond Python stdlib + authenticated gcloud. Never changes
Firestore rules, documents, composite indexes, TTL or the official project.
Default mode is read-only. --apply must be explicitly supplied.
"""
import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "atrio-catolico-qa-v2"
FIELD = (
    "projects/" + PROJECT
    + "/databases/(default)/collectionGroups/replies/fields/createdAt"
)
API = "https://firestore.googleapis.com/v1/"
INDEX = {
    "queryScope": "COLLECTION_GROUP",
    "fields": [{"fieldPath": "createdAt", "order": "DESCENDING"}],
}


def command(*args):
    return subprocess.check_output(
        ["gcloud", *args], text=True, stderr=subprocess.DEVNULL
    ).strip()


def request(method, token, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    url = API + FIELD + ("?updateMask=indexConfig" if method == "PATCH" else "")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if method == "GET" and exc.code == 404:
            return None
        raise RuntimeError("Firestore QA: HTTP " + str(exc.code)) from None


def normalize(index):
    """Preserve every known existing index without output-only API properties."""
    if index.get("queryScope") not in ("COLLECTION", "COLLECTION_GROUP"):
        raise RuntimeError("Existing index scope unknown: abort.")
    fields = index.get("fields", [])
    if len(fields) != 1 or fields[0].get("fieldPath") != "createdAt":
        raise RuntimeError("Existing field index unexpected: abort.")
    field = fields[0]
    if field.get("order") in ("ASCENDING", "DESCENDING"):
        clean = {"fieldPath": "createdAt", "order": field["order"]}
    elif field.get("arrayConfig") == "CONTAINS":
        clean = {"fieldPath": "createdAt", "arrayConfig": "CONTAINS"}
    else:
        raise RuntimeError("Existing index mode unknown: abort.")
    return {"queryScope": index["queryScope"], "fields": [clean]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if command("config", "get-value", "project") != PROJECT:
        raise RuntimeError("Set the Cloud Shell project to atrio-catolico-qa-v2 first.")

    # No accidental pay-as-you-go billing: do not apply if billing is enabled
    # or cannot be verified. The check is also useful in dry-run mode.
    billing = command(
        "billing", "projects", "describe", PROJECT,
        "--format=value(billingEnabled)",
    ).lower()
    if billing != "false":
        raise RuntimeError("QA billing is enabled/unknown; no index changes allowed.")

    token = command("auth", "print-access-token")
    if len(token) < 20:
        raise RuntimeError("Missing Google Cloud Shell authentication.")

    current = request("GET", token)
    cfg = (current or {}).get("indexConfig", {})
    existing = cfg.get("indexes", [])
    if not isinstance(existing, list):
        raise RuntimeError("Unexpected current index configuration; abort.")

    if existing:
        clean = [normalize(index) for index in existing]
    else:
        if cfg.get("usesAncestorConfig") is False:
            raise RuntimeError("Custom empty index exemption exists; abort.")
        # Field absent/inherited: keep defaults for ordinary collection queries.
        clean = [
            {"queryScope": "COLLECTION",
             "fields": [{"fieldPath": "createdAt", "order": "ASCENDING"}]},
            {"queryScope": "COLLECTION",
             "fields": [{"fieldPath": "createdAt", "order": "DESCENDING"}]},
            {"queryScope": "COLLECTION",
             "fields": [{"fieldPath": "createdAt", "arrayConfig": "CONTAINS"}]},
        ]

    # Keep all previous modes (including inherited modes); only add group DESC.
    if not any(index == INDEX for index in clean):
        clean.append(INDEX)
    else:
        found = next(
            x for x in existing
            if normalize(x) == INDEX
        )
        state = found.get("state", "UNKNOWN")
        print("QA: index already exists, state =", state)
        return

    print("QA project:", PROJECT)
    print("Existing index modes preserved:", len(clean) - 1)
    print("New index: replies.createdAt COLLECTION_GROUP DESCENDING")
    if not args.apply:
        print("DRY RUN ONLY: to submit, execute again with --apply")
        return

    result = request("PATCH", token, {
        "name": FIELD,
        "indexConfig": {"indexes": clean},
    })
    if not result.get("name"):
        raise RuntimeError("Unexpected Firestore response; verify index manually.")
    print("QA index build SUBMITTED. Confirm READY with GitHub audit.")
    print("No Firebase rules, posts, replies or production project changed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print("STOP:", str(exc)[:200], file=sys.stderr)
        sys.exit(1)
