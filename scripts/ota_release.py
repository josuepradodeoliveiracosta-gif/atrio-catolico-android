#!/usr/bin/env python3
"""Safely prepare a public Átrio Release from an *existing* verified official APK.

This script does not sign, upload, install or publish APKs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

from scripts.ota_apk_preflight import PreflightError, digest, verify

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
PACKAGE = "br.com.atriocatolico"
LEGACY_RUN_ID = 41174393714
LEGACY_COMMIT = "fcf063e835c37ca1e3f9363a56a4232d30cb8ea0"
LEGACY_WORKFLOW = ".github/workflows/atrio-v020-signed-release-once.yml"
NORMAL_WORKFLOW = ".github/workflows/build-apk.yml"
NORMAL_ARTIFACT = "atrio-catolico-release-assinado"
LEGACY_ARTIFACT = "atrio-catolico-0.20.0-release-assinado"
APK_ASSET = "atrio-catolico.apk"
MANIFEST_ASSET = "update.json"


def require(ok, code):
    if not ok:
        raise PreflightError(code)


def version_tuple(version):
    require(isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version),
            "versionName invalido")
    return tuple(map(int, version.split(".")))


def validate_source(run, artifacts, artifact_name, *, checkout_sha, git_runner=None):
    """No caller-controlled run path, branch, source tag or artifact is trusted."""
    if git_runner is None:
        def git_runner(*cmd):
            return subprocess.run(["git", *cmd], capture_output=True, text=True, check=True).stdout

    require(isinstance(run, dict), "build_desconhecido")
    require(run.get("repository", {}).get("full_name") == REPO, "repositorio_incorreto")
    require(run.get("head_branch") == "main", "build_fora_da_main")
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "compilacao_nao_concluida")
    require(run.get("run_attempt") == 1, "reexecucao_nao_autorizada")
    sha = run.get("head_sha")
    require(isinstance(sha, str) and re.fullmatch(r"[a-f0-9]{40}", sha), "commit_invalido")
    require(isinstance(checkout_sha, str) and re.fullmatch(r"[a-f0-9]{40}", checkout_sha),
            "checkout_invalido")
    require(isinstance(run.get("id"), int), "id_execucao_invalido")
    if artifact_name == NORMAL_ARTIFACT:
        valid = (run.get("path") == NORMAL_WORKFLOW
                 and run.get("event") == "workflow_dispatch")
    elif artifact_name == LEGACY_ARTIFACT:
        valid = (run.get("id") == LEGACY_RUN_ID and sha == LEGACY_COMMIT
                 and run.get("path") == LEGACY_WORKFLOW
                 and run.get("event") == "push")
    else:
        valid = False
    require(valid, "origem_da_assinatura_nao_autorizada")
    require(isinstance(artifacts, list), "artefatos_invalidos")
    matches = [item for item in artifacts
               if item.get("name") == artifact_name
               and item.get("expired") is False
               and isinstance(item.get("size_in_bytes"), int)
               and item["size_in_bytes"] > 0]
    require(len(matches) == 1, "artefato_indisponivel_ou_ambiguo")
    matching = matches[0]
    info = matching.get("workflow_run", {})
    require(info.get("id") == run["id"]
            and info.get("head_sha") == sha
            and info.get("head_branch") == "main",
            "artefato_de_outro_build")
    try:
        subprocess.run(["git", "merge-base", "--is-ancestor", sha, checkout_sha],
                       check=True, text=True, capture_output=True)
        gradle = git_runner("show", f"{sha}:app/build.gradle.kts")
    except (OSError, subprocess.CalledProcessError):
        raise PreflightError("commit_nao_pertence_a_main_revisada") from None
    codes = re.findall(r'^\s*versionCode\s*=\s*(\d+)\s*$', gradle, re.MULTILINE)
    names = re.findall(r'^\s*versionName\s*=\s*"([^"]+)"\s*$', gradle, re.MULTILINE)
    ids = re.findall(r'^\s*applicationId\s*=\s*"([^"]+)"\s*$', gradle, re.MULTILINE)
    require(len(codes) == len(names) == len(ids) == 1 and ids[0] == PACKAGE,
            "metadados_do_commit_invalidos")
    version_tuple(names[0])
    require(int(codes[0]) > 0, "versionCode_invalido")
    return {
        "runId": run["id"], "sourceSha": sha,
        "versionCode": int(codes[0]), "versionName": names[0],
        "artifactName": artifact_name, "artifactId": matching["id"],
    }


def prepare(apk, source, *, sdk, expected_certificate, expected_apk_sha256,
            notes, output, runner=None):
    require(isinstance(source, dict), "origem_nao_verificada")
    require(source.get("artifactName") in (NORMAL_ARTIFACT, LEGACY_ARTIFACT),
            "artefato_de_origem_invalido")
    require(isinstance(source.get("sourceSha"), str)
            and re.fullmatch(r"[a-f0-9]{40}", source["sourceSha"]),
            "commit_de_origem_invalido")
    code, name = source.get("versionCode"), source.get("versionName")
    require(type(code) is int and code > 0, "codigo_de_versao_invalido")
    version_tuple(name)
    require(isinstance(notes, str) and 10 <= len(notes.strip()) <= 3000,
            "notas_de_release_obrigatorias_10_a_3000_caracteres")
    require(expected_apk_sha256, "hash_previamente_conhecido_obrigatorio")
    expected_apk_sha256 = digest(expected_apk_sha256)
    cert = digest(expected_certificate)
    kwargs = dict(
        sdk=sdk, expected_cert=cert, expected_code=code, expected_name=name,
        expected_apk_sha256=expected_apk_sha256,
    )
    if runner is not None:
        kwargs["runner"] = runner
    result = verify(apk, **kwargs)
    tag = "v" + name
    asset_url = f"https://github.com/{REPO}/releases/download/{tag}/{APK_ASSET}"
    release_url = f"https://github.com/{REPO}/releases/tag/{tag}"
    metadata = {
        "schemaVersion": 1,
        "channel": "stable",
        "applicationId": PACKAGE,
        "versionName": name,
        "versionCode": code,
        "mandatory": False,
        "minimumAndroidSdk": 26,
        "apkAsset": APK_ASSET,
        "apkSizeBytes": Path(apk).stat().st_size,
        "apkSha256": result["apk_sha256"],
        "certificateSha256": cert,  # informational, never a trust anchor in the app
        "downloadUrl": asset_url,
        "releasePageUrl": release_url,
        "releaseNotes": notes.strip(),
    }
    output = Path(output)
    require(not output.exists() or not any(output.iterdir()),
            "diretorio_de_saida_deve_estar_vazio")
    output.mkdir(parents=True, exist_ok=True)
    apk_output = output / APK_ASSET
    shutil.copyfile(apk, apk_output)
    manifest_output = output / MANIFEST_ASSET
    manifest_output.write_text(json.dumps(metadata, indent=2, ensure_ascii=False,
                                          sort_keys=True) + "\n", encoding="utf-8")
    manifest_hash = hashlib.sha256(manifest_output.read_bytes()).hexdigest()
    (output / "SHA256SUMS.txt").write_text(
        f'{result["apk_sha256"]}  {APK_ASSET}\n{manifest_hash}  {MANIFEST_ASSET}\n',
        encoding="utf-8",
    )
    (output / "release-notes.md").write_text(notes.strip() + "\n", encoding="utf-8")
    (output / "source-sha.txt").write_text(source["sourceSha"] + "\n", encoding="utf-8")
    return metadata


def assert_newer(current, latest_tag):
    version_tuple(current)
    if latest_tag is None or latest_tag == "":
        return True
    require(re.fullmatch(r"v\d+\.\d+\.\d+", latest_tag) is not None,
            "tag_de_ultima_versao_invalida")
    require(version_tuple(current) > version_tuple(latest_tag[1:]),
            "versao_nao_superior_a_ultima_publicada")
    return True


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    source = sub.add_parser("source", help="Pin approved successful signed workflow run")
    source.add_argument("--run-json", required=True)
    source.add_argument("--artifacts-json", required=True)
    source.add_argument("--artifact-name", required=True)
    source.add_argument("--checkout-sha", required=True)
    source.add_argument("--output", required=True)
    gen = sub.add_parser("prepare", help="Produce release APK and update manifest offline")
    gen.add_argument("--apk", required=True)
    gen.add_argument("--source-json", required=True)
    gen.add_argument("--android-sdk", required=True)
    gen.add_argument("--expected-cert", required=True)
    gen.add_argument("--expected-apk-sha256", required=True)
    gen.add_argument("--notes-file", required=True)
    gen.add_argument("--output", required=True)
    newer = sub.add_parser("newer", help="Check version ordering before publishing")
    newer.add_argument("--version", required=True)
    newer.add_argument("--latest-tag", default="")
    args = p.parse_args()
    try:
        if args.command == "source":
            run = json.loads(Path(args.run_json).read_text(encoding="utf-8"))
            artifacts = json.loads(Path(args.artifacts_json).read_text(encoding="utf-8"))
            metadata = validate_source(run, artifacts["artifacts"],
                                       args.artifact_name, checkout_sha=args.checkout_sha)
            Path(args.output).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
            print(f"Origem aprovada: {metadata['versionName']} (code {metadata['versionCode']})")
        elif args.command == "prepare":
            source = json.loads(Path(args.source_json).read_text(encoding="utf-8"))
            notes = Path(args.notes_file).read_text(encoding="utf-8")
            result = prepare(args.apk, source, sdk=args.android_sdk,
                             expected_certificate=args.expected_cert,
                             expected_apk_sha256=args.expected_apk_sha256,
                             notes=notes, output=args.output)
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            assert_newer(args.version, args.latest_tag)
            print(f"Nova versão {args.version} supera {args.latest_tag or 'nenhuma publicação'}")
        return 0
    except (PreflightError, KeyError, ValueError, OSError, TypeError,
            json.JSONDecodeError) as exc:
        print(f"Publicação OTA bloqueada: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
