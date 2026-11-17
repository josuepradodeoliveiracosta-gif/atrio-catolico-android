#!/usr/bin/env bash
set -euo pipefail
umask 077

tools="${ANDROID_HOME:?ANDROID_HOME ausente}/build-tools/36.0.0"

case "${1:-}" in
    build|build-functional|build-round)
        output="${2:?Caminho do APK sem assinatura ausente}"
        config=app/src/qaGeral/google-services.json
        if [[ "$1" != build ]]; then
            round=0
            if [[ "$1" == build-round ]]; then
                [[ -z "${3:-}" ]] || { echo 'A rodada física exige a configuração registrada.' >&2; exit 2; }
                round=1
            fi
            case "${3:-}" in
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
            if [[ "${3:-}" != --fixture ]]; then
                python3 scripts/qa_geral_remote_build_gate.py --registered "$config"
                app_id="$(python3 -c 'from scripts.qa_geral_remote_build_gate import REGISTERED_APP_ID; print(REGISTERED_APP_ID)')"
            fi
            ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_GERAL_REMOTE_BUILD=1 ATRIO_QA_GERAL_PUSH_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_FICTICIO=0 ATRIO_QA_GERAL_CELULAR_UNSIGNED_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_FUNCIONAL=1 ATRIO_QA_GERAL_CELULAR_APP_ID="$app_id" \
                ATRIO_QA_GERAL_CELULAR_RODADA="$round" ATRIO_QA_GERAL_CELULAR_RODADA_FIXTURE=0 \
                ATRIO_QA_GERAL_CELULAR_PAIR_CODE= \
                gradle :app:assembleQaGeral --no-daemon --max-workers=2
        else
            python3 scripts/qa_geral_remote_build_gate.py --write-fixture "$config"
            trap 'rm -f -- "$config"' EXIT
            ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_GERAL_REMOTE_BUILD=1 ATRIO_QA_GERAL_PUSH_BUILD=0 \
                ATRIO_QA_GERAL_CELULAR_FICTICIO=1 ATRIO_QA_GERAL_CELULAR_UNSIGNED_BUILD=1 \
                ATRIO_QA_GERAL_CELULAR_FUNCIONAL=0 ATRIO_QA_GERAL_CELULAR_PAIR_CODE="${3:-}" \
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
        echo 'Use build <saída.apk> [versionCode do par], build-functional <saída.apk>, build-round <saída.apk> ou sign <entrada.apk> <saída.apk> <keystore>.' >&2
        exit 2
        ;;
esac
