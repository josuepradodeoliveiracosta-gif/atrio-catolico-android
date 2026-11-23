"""Confere e registra a proveniência dos perfis do APK QA 43."""

import argparse
from hashlib import sha256
import json
import re
from pathlib import Path
import sys
from xml.etree import ElementTree

from scripts.ota_apk_preflight import PreflightError, command
from scripts.qa_geral_celular_approve import PACKAGE, verify_functional_variant
from scripts.qa_geral_celular_round42 import verify_source
from scripts.qa_geral_celular_round_delivery import check_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import FUNCTIONAL_FIXTURE_APP_ID, QA_PROJECT, REGISTERED_APP_ID

VERSION_CODE = 43
VERSION_NAME = "0.19.10-qa-geral-celular-rodada-43"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def verify_package_version(apk, tools, version_code, version_name):
    badging = command([str(tools / "aapt"), "dump", "badging", str(apk)])
    match = re.search(
        r"^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'(?: |$)",
        badging,
        re.MULTILINE,
    )
    if match is None or match.groups() != (PACKAGE, str(version_code), version_name):
        raise PreflightError("Pacote ou versão do APK 43 divergente.")


# Contrato estrito dos componentes exportados no APK 43 HTTPS de QA.
# O SDK FCM precisa de uma única entrada protegida; AndroidX WorkManager e
# ProfileInstaller podem registrar entradas exclusivamente com permissão
# reservada ao sistema Android, nunca expostas a aplicações comuns.
EXPORTED_RECEIVER_CONTRACTS = {
    "com.google.firebase.iid.FirebaseInstanceIdReceiver": (
        "com.google.android.c2dm.permission.SEND",
        frozenset({"com.google.android.c2dm.intent.RECEIVE"}),
    ),
    "androidx.work.impl.diagnostics.DiagnosticsReceiver": (
        "android.permission.DUMP",
        frozenset({"androidx.work.diagnostics.REQUEST_DIAGNOSTICS"}),
    ),
    "androidx.profileinstaller.ProfileInstallReceiver": (
        "android.permission.DUMP",
        frozenset({
            "androidx.profileinstaller.action.INSTALL_PROFILE",
            "androidx.profileinstaller.action.SKIP_FILE",
            "androidx.profileinstaller.action.SAVE_PROFILE",
            "androidx.profileinstaller.action.BENCHMARK_OPERATION",
        }),
    ),
}
EXPORTED_SERVICE_CONTRACTS = {
    "androidx.work.impl.background.systemjob.SystemJobService":
        "android.permission.BIND_JOB_SERVICE",
}
# Permissões demandadas diretamente pelo app e por Firebase Messaging/WorkManager.
# Rejeita permissões Android adicionais (inclusive sensíveis) e privilégios
# arbitrários de terceiros: qualquer ampliação exige revisão explícita.
HTTPS_USES_PERMISSIONS = frozenset({
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.WAKE_LOCK",
    "android.permission.VIBRATE",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    "com.google.android.c2dm.permission.RECEIVE",
    "com.google.android.providers.gsf.permission.READ_GSERVICES",  # Google Play Services
})
LAB_COMPONENT_PREFIXES = (
    "qa", "debug", "test", "mock", "fake", "fixture", "lab",
    "inject", "ota", "updater", "update",
)


def _component_name(node):
    return (node.get(ANDROID + "name") or "").strip()


def _intent_actions(node):
    return [action.get(ANDROID + "name") for action in node.findall("intent-filter/action")]


def _check_component_contract(application):
    for kind in ("receiver", "service", "provider"):
        for node in application.findall(kind):
            component = _component_name(node)
            short = component.rsplit(".", 1)[-1].lstrip(".").lower()
            if not component or short.startswith(LAB_COMPONENT_PREFIXES) or (
                component == "androidx.core.content.FileProvider"
            ):
                raise PreflightError(f"Componente de laboratório/OTA/sem nome recusado: {component}")
            exported = node.get(ANDROID + "exported")
            if exported not in (None, "true", "false"):
                raise PreflightError(f"android:exported inválido: {component}")
            if exported is None and node.find("intent-filter") is not None:
                raise PreflightError(f"Componente com intent-filter sem exported explícito: {component}")
            if exported != "true":
                continue
            if kind == "provider":
                raise PreflightError(f"Provider exportado não autorizado: {component}")
            if kind == "receiver":
                contract = EXPORTED_RECEIVER_CONTRACTS.get(component)
                if contract is None:
                    raise PreflightError(f"Receiver exportado não autorizado: {component}")
                system_permission, permitted_actions = contract
                actions = _intent_actions(node)
                if (node.get(ANDROID + "permission") != system_permission
                        or not actions or set(actions) - permitted_actions
                        or any(not value for value in actions)):
                    raise PreflightError(f"Receiver protegido divergente: {component}")
                # Não permitir intent-filters adicionais sem ação.
                if any(not filt.findall("action") for filt in node.findall("intent-filter")):
                    raise PreflightError(f"Receiver com filtro vazio: {component}")
            elif kind == "service":
                system_permission = EXPORTED_SERVICE_CONTRACTS.get(component)
                if (system_permission is None
                        or node.get(ANDROID + "permission") != system_permission
                        or node.findall("intent-filter")):
                    raise PreflightError(f"Service exportado não autorizado: {component}")


def _check_https_permissions(manifest):
    for element in manifest:
        if element.tag == "permission":
            # Permission declaration is not a grant; protected SDK/AppCompat
            # declarations are preserved. Untrusted requests are checked below.
            continue
        if element.tag.startswith("uses-permission"):
            requested = element.get(ANDROID + "name")
            # AndroidX Core may declare only the package-scoped dynamic receiver
            # permission; no arbitrary custom permission is allowed.
            dynamic = (
                requested == PACKAGE + ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
            )
            if requested not in HTTPS_USES_PERMISSIONS and not dynamic:
                raise PreflightError(f"Permissão não autorizada no APK HTTPS: {requested}")

def verify_notice_manifest(text, *, https=False):
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
    receivers = application.findall("receiver")
    names = {node.get(name, "").rsplit(".", 1)[-1] for node in receivers}
    if auto_init != ["false"] or "QaConversationSignalReceiver" in names:
        raise PreflightError("O manifesto permite injeção do laboratório ou auto-init FCM.")
    if not https:
        if "FirebaseInstanceIdReceiver" in names:
            raise PreflightError("O laboratório não pode receber FCM externo.")
        return
    _check_https_permissions(manifest)
    _check_component_contract(application)
    if (application.get(ANDROID + "usesCleartextTraffic") != "false"
            or application.get(ANDROID + "networkSecurityConfig") is not None
            or any(node.get(name) == "androidx.core.content.FileProvider"
                   for node in application.findall("provider"))):
        raise PreflightError("O perfil HTTPS não pode usar rede de laboratório, OTA ou HTTP.")
    entry = [node for node in receivers
             if node.get(name, "").rsplit(".", 1)[-1] == "FirebaseInstanceIdReceiver"]
    if (len(entry) != 1 or entry[0].get(name) != "com.google.firebase.iid.FirebaseInstanceIdReceiver"
            or entry[0].get(ANDROID + "exported") != "true"
            or entry[0].get(ANDROID + "permission") != "com.google.android.c2dm.permission.SEND"
            or [action.get(name) for action in entry[0].findall("intent-filter/action")]
            != ["com.google.android.c2dm.intent.RECEIVE"]):
        raise PreflightError("A entrada FCM protegida do SDK está ausente ou diverge.")


def verify_fixture_metadata(apk, tools, *, notice_lab=False, notice_https=False):
    if notice_lab or notice_https:
        verify_package_version(apk, tools, VERSION_CODE, VERSION_NAME)
        analyzer = tools.parent.parent / "cmdline-tools/latest/bin/apkanalyzer"
        manifest = command([str(analyzer), "manifest", "print", str(apk.resolve())])
        verify_notice_manifest(manifest, https=notice_https)
        if notice_https:
            resources = command([str(tools / "aapt"), "dump", "--values", "resources", str(apk.resolve())])
            if QA_PROJECT not in resources or REGISTERED_APP_ID not in resources:
                raise PreflightError("O perfil HTTPS exige a identidade Firebase registrada do QA Celular.")
        digest = sha256(manifest.encode()).hexdigest()
        print(f"APK verificado: {PACKAGE}, versionCode={VERSION_CODE}, versionName={VERSION_NAME}")
        print(f"Manifesto de avisos aprovado: SHA-256={digest}")
        return digest
    verify_package_version(apk, tools, VERSION_CODE, VERSION_NAME)
    verify_functional_variant(apk, tools, VERSION_CODE, FUNCTIONAL_FIXTURE_APP_ID,
                              expected_code=VERSION_CODE)


def record_proof(repo, sha, tree, apk, apk_hash, certificate, tools, *, notice_lab=False, notice_https=False):
    verify_source(repo, sha, tree)
    actual_hash = check_sha256(apk, apk_hash)
    verify_signature(apk, tools / "apksigner", certificate)
    manifest_digest = verify_fixture_metadata(apk, tools, notice_lab=notice_lab, notice_https=notice_https)
    receipt = {
        "environment": "notice-https" if notice_https else "notice-lab" if notice_lab else "fixture",
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
        profile = mode.add_mutually_exclusive_group()
        profile.add_argument("--notice-lab", action="store_true")
        profile.add_argument("--notice-https", action="store_true")
    args = parser.parse_args()
    try:
        if args.mode == "metadata":
            verify_fixture_metadata(args.apk, args.build_tools, notice_lab=args.notice_lab,
                                    notice_https=args.notice_https)
        else:
            receipt = record_proof(args.repo, args.sha, args.tree, args.apk, args.apk_sha256,
                                   args.certificate_sha256, args.build_tools,
                                   notice_lab=args.notice_lab, notice_https=args.notice_https)
            print(json.dumps(receipt, sort_keys=True))
    except (PreflightError, OSError) as exc:
        print(f"Recusado: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
