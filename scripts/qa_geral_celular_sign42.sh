#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

apk="${1:?APK sem assinatura ausente}"
encrypted="${2:-}"
tools="${ANDROID_HOME:?Android SDK ausente}/build-tools/36.0.0"
reference="${ATRIO_QA_CELULAR_CERT_SHA256:?Certificado de referência ausente}"
[[ "$reference" =~ ^[0-9a-fA-F]{64}$ ]]
if [[ -n "$encrypted" ]]; then
    [[ ! -e "$encrypted" && ! -L "$encrypted" ]]
    : "${ATRIO_QA_CELULAR_AGE_RECIPIENT:?Destinatário age ausente}"
fi

python3 -m scripts.qa_geral_celular_round42 metadata "$apk" --build-tools "$tools"
work="$(mktemp -d "${RUNNER_TEMP:?Diretório temporário ausente}/qa-celular-42.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
signed="$work/qa-celular-42.apk"
printf '%s' "${ATRIO_QA_CELULAR_KEYSTORE_BASE64:?Keystore de QA ausente}" | base64 --decode > "$work/qa.keystore"
unset ATRIO_QA_CELULAR_KEYSTORE_BASE64
bash scripts/qa_geral_celular_manual.sh sign "$apk" "$signed" "$work/qa.keystore"
rm -- "$work/qa.keystore"
unset ATRIO_QA_CELULAR_KEY_ALIAS ATRIO_QA_CELULAR_STORE_PASSWORD ATRIO_QA_CELULAR_KEY_PASSWORD

apk_sha256="$(sha256sum < "$signed" | cut -d ' ' -f 1)"
python3 -m scripts.qa_geral_celular_round42 verify "$signed" "$apk_sha256" \
    --build-tools "$tools" --certificate "$reference"
if [[ -n "$encrypted" ]]; then
    age --encrypt --recipient "$ATRIO_QA_CELULAR_AGE_RECIPIENT" --output "$encrypted" "$signed"
    test -s "$encrypted"
    printf 'SHA-256 do APK cifrado: %s\n' "$(sha256sum < "$encrypted" | cut -d ' ' -f 1)"
fi
