#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

apk="${1:?APK sem assinatura ausente}"
encrypted="${2:-}"
tools="${ANDROID_HOME:?Android SDK ausente}/build-tools/36.0.0"
reference="${ATRIO_QA_CELULAR_CERT_SHA256:?SHA-256 de referência ausente}"
[[ "$reference" =~ ^[0-9a-fA-F]{64}$ ]] || exit 2

if [[ -n "$encrypted" ]]; then
    [[ ! -e "$encrypted" && ! -L "$encrypted" ]]
    : "${ATRIO_QA_CELULAR_AGE_RECIPIENT:?Destinatário age ausente}"
fi

# Verificar o APK antes de materializar o keystore.
python3 - "$apk" "$tools" <<'PY'
from pathlib import Path
import sys

from scripts.qa_geral_celular_approve import read_version_code, verify_functional_variant
from scripts.qa_geral_remote_build_gate import REGISTERED_APP_ID

apk, sdk = map(Path, sys.argv[1:])
verify_functional_variant(apk, sdk, read_version_code(apk, sdk), REGISTERED_APP_ID, expected_code=41)
PY

work="$(mktemp -d "${RUNNER_TEMP:?Diretório temporário ausente}/qa-celular-41.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
signed="$work/qa-celular-41.apk"
printf '%s' "${ATRIO_QA_CELULAR_KEYSTORE_BASE64:?Keystore de QA ausente}" | base64 --decode > "$work/qa.keystore"
unset ATRIO_QA_CELULAR_KEYSTORE_BASE64

bash scripts/qa_geral_celular_manual.sh sign "$apk" "$signed" "$work/qa.keystore"
rm -- "$work/qa.keystore"
unset ATRIO_QA_CELULAR_KEY_ALIAS ATRIO_QA_CELULAR_STORE_PASSWORD ATRIO_QA_CELULAR_KEY_PASSWORD

python3 -m scripts.qa_geral_celular_signature --apk "$signed" --apksigner "$tools/apksigner"
"$tools/aapt" dump badging "$signed" | grep -F "package: name='br.com.atriocatolico.qageral.celular' versionCode='41' "
printf 'SHA-256 do certificado: %s\n' "${reference,,}"
apk_sha256="$(sha256sum "$signed" | cut -d ' ' -f 1)"
printf 'SHA-256 do APK assinado: %s\n' "$apk_sha256"

if [[ -n "$encrypted" ]]; then
    age --encrypt --recipient "$ATRIO_QA_CELULAR_AGE_RECIPIENT" --output "$encrypted" "$signed"
    test -s "$encrypted"
    cipher_sha256="$(sha256sum < "$encrypted" | cut -d ' ' -f 1)"
    printf 'SHA-256 do APK cifrado: %s\n' "$cipher_sha256"
fi
