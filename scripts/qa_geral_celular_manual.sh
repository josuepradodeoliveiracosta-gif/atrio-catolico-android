#!/usr/bin/env bash
set -euo pipefail
umask 077

tools="${ANDROID_HOME:?ANDROID_HOME ausente}/build-tools/36.0.0"

case "${1:-}" in
    build)
        output="${2:?Caminho do APK sem assinatura ausente}"
        config=app/src/qaGeral/google-services.json
        python3 scripts/qa_geral_remote_build_gate.py --write-fixture "$config"
        trap 'rm -f -- "$config"' EXIT
        ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_GERAL_REMOTE_BUILD=1 ATRIO_QA_GERAL_PUSH_BUILD=0 \
            ATRIO_QA_GERAL_CELULAR_FICTICIO=1 ATRIO_QA_GERAL_CELULAR_UNSIGNED_BUILD=1 \
            gradle :app:assembleQaGeral --no-daemon --max-workers=2
        shopt -s nullglob
        apks=(app/build/outputs/apk/qaGeral/*.apk)
        if [[ "${#apks[@]}" != 1 || ! -s "${apks[0]}" ]]; then
            echo 'Esperado exatamente um APK QA Geral Celular.' >&2
            exit 1
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
        echo 'Use build <saída.apk> ou sign <entrada.apk> <saída.apk> <keystore>.' >&2
        exit 2
        ;;
esac
