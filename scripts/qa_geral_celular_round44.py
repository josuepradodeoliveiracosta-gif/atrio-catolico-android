"""Round 44 only: reuse the audited HTTPS manifest contract of round 43."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys

from scripts.ota_apk_preflight import PreflightError, command
from scripts.qa_geral_celular_round42 import verify_source, verify_package_version
from scripts.qa_geral_celular_round43 import verify_notice_manifest
from scripts.qa_geral_celular_approve import PACKAGE
from scripts.qa_geral_celular_round_delivery import check_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import QA_PROJECT, REGISTERED_APP_ID

VERSION_CODE = 44
VERSION_NAME = "0.19.10-qa-geral-celular-rodada-44"


def verify_metadata(apk, tools):
    verify_package_version(apk, tools, VERSION_CODE, VERSION_NAME)
    analyzer = tools.parent.parent / "cmdline-tools/latest/bin/apkanalyzer"
    manifest = command([str(analyzer), "manifest", "print", str(apk.resolve())])
    verify_notice_manifest(manifest, https=True)
    resources = command([str(tools / "aapt"), "dump", "--values", "resources", str(apk.resolve())])
    if QA_PROJECT not in resources or REGISTERED_APP_ID not in resources:
        raise PreflightError("Identidade Firebase QA registrada ausente.")
    digest = sha256(manifest.encode()).hexdigest()
    print(f"APK verificado: {PACKAGE}, versionCode={VERSION_CODE}, versionName={VERSION_NAME}")
    print(f"Manifesto HTTPS aprovado: SHA-256={digest}")
    return digest


def record_proof(repo, sha, tree, apk, apk_hash, certificate, tools):
    verify_source(repo, sha, tree)
    actual = check_sha256(apk, apk_hash)
    verify_signature(apk, tools / "apksigner", certificate)
    manifest = verify_metadata(apk, tools)
    return {"environment": "notice-https-44", "git_sha": sha, "git_tree": tree,
            "package": PACKAGE, "version_code": VERSION_CODE, "version_name": VERSION_NAME,
            "apk_sha256": actual, "certificate_sha256": certificate.lower(),
            "manifest_sha256": manifest}


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
            verify_metadata(args.apk, args.build_tools)
        else:
            print(json.dumps(record_proof(args.repo, args.sha, args.tree, args.apk,
                                          args.apk_sha256, args.certificate_sha256,
                                          args.build_tools), sort_keys=True))
    except (PreflightError, OSError) as exc:
        print(f"Recusado: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
