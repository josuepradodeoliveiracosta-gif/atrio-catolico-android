"""Valida localmente a configuração do Android QA Geral para celular."""
import json
from pathlib import Path
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Campo JSON duplicado.")
        result[key] = value
    return result


def validate(path, project_id, app_id, package_name):
    if not path.is_file() or path.is_symlink() or path.parent.is_symlink():
        raise ValueError("Configuração Firebase ausente ou simbólica.")
    if not 0 < path.stat().st_size <= 1024 * 1024:
        raise ValueError("Tamanho da configuração Firebase inválido.")

    config = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    project = config["project_info"]
    if (project["project_id"], str(project["project_number"])) != (
        project_id, app_id.split(":")[1]
    ):
        raise ValueError("Projeto ou número do Firebase incorreto.")

    client, = config["client"]
    info = client["client_info"]
    if (info["mobilesdk_app_id"], info["android_client_info"]["package_name"]) != (
        app_id, package_name
    ):
        raise ValueError("App ID ou pacote Android incorreto.")
    api_key, = client["api_key"]
    if not isinstance(api_key["current_key"], str) or len(api_key["current_key"]) < 8:
        raise ValueError("Chave de cliente do Android ausente.")

    bucket = project.get("storage_bucket")
    if bucket is not None and bucket not in (
        project_id + ".appspot.com", project_id + ".firebasestorage.app"
    ):
        raise ValueError("Storage não pertence ao QA Geral.")
    if "firebase_url" in project:
        raise ValueError("Realtime Database não faz parte deste build.")
    if "atrio-catolico" in json.dumps(config, ensure_ascii=False).casefold().replace(
        project_id.casefold(), ""
    ):
        raise ValueError("Referência a outro projeto Átrio na configuração.")


if __name__ == "__main__":
    path, project_id, app_id, package_name = sys.argv[1:]
    try:
        validate(Path(path), project_id, app_id, package_name)
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        print("Configuração recusada. Confira projeto, App ID e pacote Android.", file=sys.stderr)
        sys.exit(1)
    print("Configuração Android QA Geral validada.")
