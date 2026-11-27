"""Round 50 only: reuse the audited HTTPS manifest contract of round 43."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys
from zipfile import BadZipFile, ZipFile

from scripts.ota_apk_preflight import PreflightError, command
from scripts.qa_geral_celular_round42 import verify_source, verify_package_version
from scripts.qa_geral_celular_round43 import verify_notice_manifest
from scripts.qa_geral_celular_approve import PACKAGE
from scripts.qa_geral_celular_round_delivery import check_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import QA_PROJECT, REGISTERED_APP_ID

VERSION_CODE = 50
VERSION_NAME = "0.19.10-qa-geral-celular-rodada-50"


# Approved resource hashes, independent of the APK and of candidate execution.
EXPECTED_ASSETS = {
    "assets/login-vitrais/login_vitral_advento.webp": "25f798d987817d893a1a2777993d4e7be9dd266fb4018dce3174e3b4eb66e771",
    "assets/login-vitrais/login_vitral_natal.webp": "d1e1a95f3f980ba9bf7892e7d8b850f96d2c6e754d14a6963f6bd346820b216f",
    "assets/login-vitrais/login_vitral_pascoa.webp": "b3c29575a9a7d74139cd852746f1a2fb4bf2067d514bb267900f77e2d957a53e",
    "assets/login-vitrais/login_vitral_quaresma.webp": "048e68e8cae11ccc399d9f8318c384c8e75a6f476d3f7d87d66396701c028678",
    "assets/login-vitrais/login_vitral_tempo_comum.webp": "9eb32efb8a8e2d10c33d6155c426378cdfcabead4293c7e4591230b25adb8b62",
    "assets/login-vitrais/login_vitral_triduo_pascal.webp": "c13f6d9ffab67be2027d01d14c11fc483b8f09d18d2aaa8ebf520a38dc1e93c6",
    "assets/cadastro-vitrais/cadastro_vitral_advento.webp": "7668830b405bc6de521af20d39af4b03c9209b74663f9dd0e6e49473fe9f2a51",
    "assets/cadastro-vitrais/cadastro_vitral_natal.webp": "8bfd835d0266494dacd79e2ce731ddf57936bfffcdbf20a1037f868a1f971485",
    "assets/cadastro-vitrais/cadastro_vitral_tempo_comum.webp": "9c5a203f2b1db638da353f1761db4bb96d3bf56c1940c76d06d8d6fc30edd23d",
    "assets/cadastro-vitrais/cadastro_vitral_quaresma.webp": "066c34afe35404c2d17ba00270513ffdbd8a4a970b2ec29ccf6e63c273701731",
    "assets/cadastro-vitrais/cadastro_vitral_triduo_pascal.webp": "0b49870595d6d02684c65e50c558fc56906e13c64448c9b426dcffba78596491",
    "assets/cadastro-vitrais/cadastro_vitral_pascoa.webp": "116b03d1a0be3cb854bbb6de80e8eecbf16d3b7c6d3a7834125af48f6460661a",
    "assets/boas-vindas-vitrais/boas_vindas_vitral_advento.webp": "4f39cd854a99b29760f11d79cecc2395e09dfb3cf3565c39eb91b60edeec35fe",
    "assets/boas-vindas-vitrais/boas_vindas_vitral_natal.webp": "b54bca717a05d7e58fd3b8050f32a57f70b448c3c75a135827dd8ebb739bb1eb",
    "assets/boas-vindas-vitrais/boas_vindas_vitral_tempo_comum.webp": "12b9f8adb9c7203ce8cabda4a2351c8b85edb50dc57fae3ff8cf6d5957f04905",
    "assets/boas-vindas-vitrais/boas_vindas_vitral_quaresma.webp": "df91dff7d091d267dfcbfbde7ceafb0e6093d2ab5b3c03b3484a1ed6a033db3a",
    "assets/boas-vindas-vitrais/boas_vindas_vitral_triduo_pascal.webp": "aadca1fdb4876dbc80eca355afd4f2aa916a4ae555312abf077d1d41e311a407",
    "assets/boas-vindas-vitrais/boas_vindas_vitral_pascoa.webp": "9ff9265a7758c79f775a12ba0faf6a108e8930f0ea96cf7a491d93e1f1e771d2",
    "assets/participacao-vitrais/participacao_vitral_advento.webp": "6fca18e2fa6601fa7aaa655bbbd11a13256b435cbc64261c6752c6c273b34333",
    "assets/participacao-vitrais/participacao_vitral_natal.webp": "901cf551c528b7540341a4d556c3a1cbb71b7117123cc401eaeef9ef73ab21cb",
    "assets/participacao-vitrais/participacao_vitral_tempo_comum.webp": "b9d716e79f2b0b8582724dc35228d93b0042cb9fbb6d23ded51c3ae857ab080c",
    "assets/participacao-vitrais/participacao_vitral_quaresma.webp": "d68c783dac68d7872aeae7a65455787fd0e5625917a1ce4456674fba4420dc96",
    "assets/participacao-vitrais/participacao_vitral_triduo_pascal.webp": "de42a3128073e0b4dd2a2a1559b4833442ffaaa288ef661e2c72562ab0fcef68",
    "assets/participacao-vitrais/participacao_vitral_pascoa.webp": "eee64b19f93e596a863d39b9bab10c3d8dfc49581839b8843b94e1932ffd4bf2",
}


def verify_assets(apk):
    """Reject missing, duplicated or altered artwork in each of the four areas."""
    try:
        with ZipFile(apk) as archive:
            names = archive.namelist()
            for name, expected in EXPECTED_ASSETS.items():
                if names.count(name) != 1 or sha256(archive.read(name)).hexdigest() != expected:
                    raise PreflightError(f"Vitral ausente, duplicado ou alterado: {name}")
    except (BadZipFile, RuntimeError, OSError) as exc:
        raise PreflightError("Não foi possível verificar os vitrais no APK.") from exc
    print("Vitrais: 24 artes conferidas por SHA-256.")


def verify_metadata(apk, tools):
    verify_package_version(apk, tools, VERSION_CODE, VERSION_NAME)
    analyzer = tools.parent.parent / "cmdline-tools/latest/bin/apkanalyzer"
    manifest = command([str(analyzer), "manifest", "print", str(apk.resolve())])
    verify_notice_manifest(manifest, https=True)
    resources = command([str(tools / "aapt"), "dump", "--values", "resources", str(apk.resolve())])
    if QA_PROJECT not in resources or REGISTERED_APP_ID not in resources:
        raise PreflightError("Identidade Firebase QA registrada ausente.")
    verify_assets(apk)
    digest = sha256(manifest.encode()).hexdigest()
    print(f"APK verificado: {PACKAGE}, versionCode={VERSION_CODE}, versionName={VERSION_NAME}")
    print(f"Manifesto HTTPS aprovado: SHA-256={digest}")
    return digest


def record_proof(repo, sha, tree, apk, apk_hash, certificate, tools):
    verify_source(repo, sha, tree)
    actual = check_sha256(apk, apk_hash)
    verify_signature(apk, tools / "apksigner", certificate)
    manifest = verify_metadata(apk, tools)
    return {"environment": "notice-https-50", "git_sha": sha, "git_tree": tree,
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
