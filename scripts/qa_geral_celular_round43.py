"""Confere e registra a proveniência do APK 43 do ensaio fictício."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys
from xml.etree import ElementTree

from scripts.ota_apk_preflight import PreflightError, command
from scripts.qa_geral_celular_approve import PACKAGE
from scripts.qa_geral_celular_round42 import verify_metadata, verify_package_version, verify_source
from scripts.qa_geral_celular_round_delivery import check_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import FUNCTIONAL_FIXTURE_APP_ID

VERSION_CODE = 43
VERSION_NAME = "0.19.10-qa-geral-celular-rodada-43"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def verify_notice_manifest(text):
    try:
        manifest = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        raise PreflightError("Manifesto do laboratório inválido.") from exc
    name = ANDROID + "name"
    application = manifest.find("application")
    if application is None or application.get(ANDROID + "allowBackup") != "false":
        raise PreflightError("O laboratório de avisos exige backup desativado.")
    permissions = {permission.get(name) for permission in manifest.findall("uses-permission")}
    if ("android.permission.POST_NOTIFICATIONS" not in permissions or
            "android.permission.REQUEST_INSTALL_PACKAGES" in permissions):
        raise PreflightError("Permissões do laboratório de avisos divergentes.")
    service = [
        node for node in application.findall("service")
        if node.get(name) in (".AtrioPushService", "br.com.atriocatolico.AtrioPushService")
    ]
    if (len(service) != 1 or service[0].get(ANDROID + "exported") != "false" or
            not any(action.get(name) == "com.google.firebase.MESSAGING_EVENT"
                    for action in service[0].findall("intent-filter/action"))):
        raise PreflightError("Serviço privado de avisos ou ação FCM ausente no manifesto.")
    auto_init = [
        node.get(ANDROID + "value") for node in application.findall("meta-data")
        if node.get(name) == "firebase_messaging_auto_init_enabled"
    ]
    receivers = {node.get(name, "").rsplit(".", 1)[-1] for node in application.findall("receiver")}
    if auto_init != ["false"] or receivers.intersection(
            {"FirebaseInstanceIdReceiver", "QaConversationSignalReceiver"}):
        raise PreflightError("O manifesto permite entrada externa ou auto-init FCM no laboratório.")


def verify_fixture_metadata(apk, tools, *, notice_lab=False):
    if notice_lab:
        verify_package_version(apk, tools, VERSION_CODE, VERSION_NAME)
        analyzer = tools.parent.parent / "cmdline-tools/latest/bin/apkanalyzer"
        manifest = command([str(analyzer), "manifest", "print", str(apk.resolve())])
        verify_notice_manifest(manifest)
        digest = sha256(manifest.encode()).hexdigest()
        print(f"APK verificado: {PACKAGE}, versionCode={VERSION_CODE}, versionName={VERSION_NAME}")
        print(f"Manifesto do laboratório de avisos aprovado: SHA-256={digest}")
        return digest
    verify_metadata(apk, tools, version_code=VERSION_CODE, version_name=VERSION_NAME,
                    firebase_app_id=FUNCTIONAL_FIXTURE_APP_ID)


def record_proof(repo, sha, tree, apk, apk_hash, certificate, tools, *, notice_lab=False):
    verify_source(repo, sha, tree)
    actual_hash = check_sha256(apk, apk_hash)
    verify_signature(apk, tools / "apksigner", certificate)
    manifest_digest = verify_fixture_metadata(apk, tools, notice_lab=notice_lab)
    receipt = {
        "environment": "notice-lab" if notice_lab else "fixture",
        "git_sha": sha,
        "git_tree": tree,
        "package": PACKAGE,
        "version_code": VERSION_CODE,
        "version_name": VERSION_NAME,
        "apk_sha256": actual_hash,
        "certificate_sha256": certificate.lower(),
    }
    if manifest_digest:
        receipt["manifest_sha256"] = manifest_digest
    return receipt


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
        mode.add_argument("--notice-lab", action="store_true")
    args = parser.parse_args()
    try:
        if args.mode == "metadata":
            verify_fixture_metadata(args.apk, args.build_tools, notice_lab=args.notice_lab)
        else:
            receipt = record_proof(args.repo, args.sha, args.tree, args.apk, args.apk_sha256,
                                   args.certificate_sha256, args.build_tools,
                                   notice_lab=args.notice_lab)
            print(json.dumps(receipt, sort_keys=True))
    except (PreflightError, OSError) as exc:
        print(f"Recusado: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
