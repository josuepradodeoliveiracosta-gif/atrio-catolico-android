#!/usr/bin/env bash
set -euo pipefail
umask 077

tools="${ANDROID_HOME:?ANDROID_HOME ausente}/build-tools/36.0.0"

case "${1:-}" in
    build|build-functional|build-round|build-round-42|build-round-43-fixture|build-round-43-notice-lab)
        output="${2:?Caminho do APK sem assinatura ausente}"
        config=app/src/qaGeral/google-services.json
        if [[ "$1" == build-round-43-notice-lab ]]; then
            [[ $# == 2 && -f app/src/qaGeral/AndroidManifest.notices.xml ]]
            [[ ! -e app/google-services.json && ! -L app/google-services.json ]]
            [[ ! -e "$config" && ! -L "$config" ]]
            ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_GERAL_REMOTE_BUILD=0 ATRIO_QA_GERAL_PUSH_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_PILOT=1 ATRIO_QA_CONVERSATION_NOTICE_LAB=1 \
                ATRIO_QA_GERAL_CELULAR_RODADA43_NOTICE_LAB=1 \
                gradle :app:assembleQaGeral --no-daemon --max-workers=2
        elif [[ "$1" != build ]]; then
            round=0
            round42=0
            round43_fixture=0
            config_mode="${3:-}"
            if [[ "$1" == build-round-43-fixture ]]; then
                [[ -z "$config_mode" ]] || { echo 'O ensaio 43 aceita apenas configuração fictícia.' >&2; exit 2; }
                config_mode=--fixture
                round43_fixture=1
            fi
            if [[ "$1" == build-round || "$1" == build-round-42 ]]; then
                [[ -z "${3:-}" ]] || { echo 'A rodada física exige a configuração registrada.' >&2; exit 2; }
                if [[ "$1" == build-round-42 ]]; then
                    round42=1
                else
                    round=1
                fi
            fi
            case "$config_mode" in
                --fixture)
                    python3 scripts/qa_geral_remote_build_gate.py --write-functional-fixture "$config"
                    app_id=1:835727158563:android:0000000000000000000000
                    ;;
                "")
                    [[ -d "${config%/*}" && ! -L "${config%/*}" ]]
                    : "${ATRIO_QA_CELULAR_GOOGLE_SERVICES_JSON:?JSON do QA Geral Celular ausente}"
                    (set -o noclobber; printf '%s' "$ATRIO_QA_CELULAR_GOOGLE_SERVICES_JSON" > "$config")
                    ;;
                *) echo 'Opção inválida do build funcional.' >&2; exit 2 ;;
            esac
            trap 'rm -f -- "$config"' EXIT
            unset ATRIO_QA_CELULAR_GOOGLE_SERVICES_JSON
            if [[ "$config_mode" != --fixture ]]; then
                python3 scripts/qa_geral_remote_build_gate.py --registered "$config"
                app_id="$(python3 -c 'from scripts.qa_geral_remote_build_gate import REGISTERED_APP_ID; print(REGISTERED_APP_ID)')"
            fi
            ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_GERAL_REMOTE_BUILD=1 ATRIO_QA_GERAL_PUSH_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_FICTICIO=0 ATRIO_QA_GERAL_CELULAR_UNSIGNED_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_FUNCIONAL=1 ATRIO_QA_GERAL_CELULAR_APP_ID="$app_id" \
                ATRIO_QA_GERAL_CELULAR_RODADA="$round" ATRIO_QA_GERAL_CELULAR_RODADA_FIXTURE="$round43_fixture" \
                ATRIO_QA_GERAL_CELULAR_RODADA42="$round42" ATRIO_QA_GERAL_CELULAR_RODADA43_FIXTURE="$round43_fixture" \
                ATRIO_QA_GERAL_CELULAR_PAIR_CODE= \
                gradle :app:assembleQaGeral --no-daemon --max-workers=2
        else
            python3 scripts/qa_geral_remote_build_gate.py --write-fixture "$config"
            trap 'rm -f -- "$config"' EXIT
            ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_GERAL_REMOTE_BUILD=1 ATRIO_QA_GERAL_PUSH_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_FICTICIO=1 ATRIO_QA_GERAL_CELULAR_UNSIGNED_BUILD=1 \
                ATRIO_QA_GERAL_CELULAR_FUNCIONAL=0 ATRIO_QA_GERAL_CELULAR_PAIR_CODE="${3:-}" \
                ATRIO_QA_GERAL_CELULAR_RODADA42=0 ATRIO_QA_GERAL_CELULAR_RODADA43_FIXTURE=0 \
                gradle :app:assembleQaGeral --no-daemon --max-workers=2
        fi
        shopt -s nullglob
        apks=(app/build/outputs/apk/qaGeral/*.apk)
        if [[ "${#apks[@]}" != 1 || ! -s "${apks[0]}" ]]; then
            echo 'Esperado exatamente um APK QA Geral Celular.' >&2
            exit 1
        fi
        if [[ "$1" == build-round ]]; then
            "$tools/aapt" dump badging "${apks[0]}" |
                grep -F "package: name='br.com.atriocatolico.qageral.celular' versionCode='41' " >/dev/null
        elif [[ "$1" == build-round-42 ]]; then
            python3 -m scripts.qa_geral_celular_round42 metadata "${apks[0]}" --build-tools "$tools"
        elif [[ "$1" == build-round-43-fixture ]]; then
            python3 -m scripts.qa_geral_celular_round43 metadata "${apks[0]}" --build-tools "$tools"
        elif [[ "$1" == build-round-43-notice-lab ]]; then
            python3 -m scripts.qa_geral_celular_round43 metadata "${apks[0]}" --build-tools "$tools" --notice-lab
        fi
        "$tools/zipalign" -P 16 4 "${apks[0]}" "$output"
        ;;
    sign)
        unsigned="${2:?Caminho de entrada ausente}"
        signed="${3:?Caminho de saída ausente}"
        keystore="${4:?Keystore ausente}"
        : "${ATRIO_QA_CELULAR_KEY_ALIAS:?Alias ausente}"
        : "${ATRIO_QA_CELULAR_STORE_PASSWORD:?Senha do keystore ausente}"
        : "${ATRIO_QA_CELULAR_KEY_PASSWORD:?Senha da chave ausente}"
        "$tools/apksigner" sign --ks "$keystore" --ks-key-alias "$ATRIO_QA_CELULAR_KEY_ALIAS" \
            --ks-pass env:ATRIO_QA_CELULAR_STORE_PASSWORD --key-pass env:ATRIO_QA_CELULAR_KEY_PASSWORD \
            --v4-signing-enabled false --out "$signed" "$unsigned"
        ;;
    *)
        echo 'Use build, build-functional, build-round (41), build-round-42, build-round-43-fixture, build-round-43-notice-lab ou sign. Nos builds, informe o caminho de saída.' >&2
        exit 2
        ;;
esac
