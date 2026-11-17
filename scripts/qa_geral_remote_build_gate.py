"""Valida localmente a configuração do Android QA Geral para celular."""
import json
from pathlib import Path
import sys


CELULAR_PACKAGE = "br.com.atriocatolico.qageral.celular"
QA_PROJECT = "atrio-catolico-qa-general"
REGISTERED_APP_ID = "1:835727158563:android:4258e81cc0ccc4df5cb096"
FUNCTIONAL_FIXTURE_APP_ID = "1:835727158563:android:0000000000000000000000"
FIXTURE_KEY = "chave-ficticia-apenas-para-compilacao"


def fixture(project_id, app_id):
    return {
        "project_info": {
            "project_number": app_id.split(":")[1],
            "project_id": project_id,
        },
        "client": [{
            "client_info": {
                "mobilesdk_app_id": app_id,
                "android_client_info": {"package_name": CELULAR_PACKAGE},
            },
            "api_key": [{"current_key": FIXTURE_KEY}],
        }],
        "configuration_version": "1",
    }


CELULAR_FICTICIO = fixture(
    "atrio-catolico-qa-geral-ficticio",
    "1:000000000000:android:0000000000000000000000",
)
FUNCTIONAL_FIXTURE = fixture(QA_PROJECT, FUNCTIONAL_FIXTURE_APP_ID)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Campo JSON duplicado.")
        result[key] = value
    return result


def validate(path, project_id, app_id, package_name, *, functional=False):
    if functional and (
        package_name != CELULAR_PACKAGE
        or project_id != QA_PROJECT
        or app_id not in (REGISTERED_APP_ID, FUNCTIONAL_FIXTURE_APP_ID)
    ):
        raise ValueError("Referência inválida para o QA Geral Celular funcional.")
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
    if functional:
        if app_id == FUNCTIONAL_FIXTURE_APP_ID:
            if config != FUNCTIONAL_FIXTURE:
                raise ValueError("A configuração funcional de CI deve ser a fixture exata.")
        elif api_key["current_key"] == FIXTURE_KEY:
            raise ValueError("O App ID funcional exige uma chave de cliente de QA.")
    elif package_name == CELULAR_PACKAGE and config != CELULAR_FICTICIO:
        raise ValueError("O pacote QA Geral Celular exige a configuração fictícia exata.")

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
    fixtures = {
        "--write-fixture": CELULAR_FICTICIO,
        "--write-functional-fixture": FUNCTIONAL_FIXTURE,
    }
    args = sys.argv[1:]
    try:
        if len(args) == 2 and args[0] == "--registered":
            validate(Path(args[1]), QA_PROJECT, REGISTERED_APP_ID, CELULAR_PACKAGE, functional=True)
            print(f"Configuração Android validada: {QA_PROJECT}, {CELULAR_PACKAGE}, {REGISTERED_APP_ID}.")
            sys.exit(0)
        if len(args) == 2 and args[0] in fixtures:
            with Path(args[1]).open("x", encoding="utf-8") as file:
                json.dump(fixtures[args[0]], file)
            sys.exit(0)
        functional = len(args) == 5 and args[-1] == "--functional"
        path, project_id, app_id, package_name = args[:4] if functional else args
        validate(Path(path), project_id, app_id, package_name, functional=functional)
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        print("Configuração recusada. Confira projeto, App ID e pacote Android.", file=sys.stderr)
        sys.exit(1)
    print("Configuração Android QA Geral validada.")
