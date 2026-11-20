"""Confere e registra a proveniência do APK 43 do ensaio fictício."""

import argparse
import json
from pathlib import Path
import sys

from scripts.ota_apk_preflight import PreflightError
from scripts.qa_geral_celular_approve import PACKAGE
from scripts.qa_geral_celular_round42 import verify_metadata, verify_source
from scripts.qa_geral_celular_round_delivery import check_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import FUNCTIONAL_FIXTURE_APP_ID

VERSION_CODE = 43
VERSION_NAME = "0.19.10-qa-geral-celular-rodada-43"


def verify_fixture_metadata(apk, tools):
    verify_metadata(apk, tools, version_code=VERSION_CODE, version_name=VERSION_NAME,
                    firebase_app_id=FUNCTIONAL_FIXTURE_APP_ID)


def record_proof(repo, sha, tree, apk, apk_hash, certificate, tools):
    verify_source(repo, sha, tree)
    actual_hash = check_sha256(apk, apk_hash)
    verify_signature(apk, tools / "apksigner", certificate)
    verify_fixture_metadata(apk, tools)
    return {
        "environment": "fixture",
        "git_sha": sha,
        "git_tree": tree,
        "package": PACKAGE,
        "version_code": VERSION_CODE,
        "version_name": VERSION_NAME,
        "apk_sha256": actual_hash,
        "certificate_sha256": certificate.lower(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    metadata = sub.add_parser("metadata")
    proof = sub.add_parser("proof")
    proof.add_argument("repo", type=Path)
    proof.add_argument("sha")
    proof.add_argument("tree")
    proof.add_argument("apk_sha256")
    proof.add_argument("certificate_sha256")
    for mode in (metadata, proof):
        mode.add_argument("apk", type=Path)
        mode.add_argument("--build-tools", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "metadata":
            verify_fixture_metadata(args.apk, args.build_tools)
        else:
            receipt = record_proof(args.repo, args.sha, args.tree, args.apk, args.apk_sha256,
                                   args.certificate_sha256, args.build_tools)
            print(json.dumps(receipt, sort_keys=True))
    except (PreflightError, OSError) as exc:
        print(f"Recusado: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
