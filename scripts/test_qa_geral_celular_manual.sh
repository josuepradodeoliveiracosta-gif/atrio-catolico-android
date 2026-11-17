#!/usr/bin/env bash
# Exercita a compilação, a assinatura e a aprovação do fluxo com ferramentas do SDK.
set -euo pipefail
umask 077

work="$(mktemp -d "${RUNNER_TEMP:?RUNNER_TEMP ausente}/qa-celular-fixtures.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
sdk="$ANDROID_HOME/build-tools/36.0.0"
unsigned="$work/unsigned.apk"
signed="$work/signed.apk"
keystore="$work/fixture.p12"

bash scripts/qa_geral_celular_manual.sh build "$unsigned"

export ATRIO_QA_CELULAR_STORE_PASSWORD
ATRIO_QA_CELULAR_STORE_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
export ATRIO_QA_CELULAR_KEY_PASSWORD="$ATRIO_QA_CELULAR_STORE_PASSWORD"
export ATRIO_QA_CELULAR_KEY_ALIAS=fixture-a
for alias in fixture-a fixture-b; do
    keytool -genkeypair -alias "$alias" -keyalg RSA -keysize 2048 -validity 2 -dname "CN=$alias" \
        -storetype PKCS12 -keystore "$keystore" \
        -storepass:env ATRIO_QA_CELULAR_STORE_PASSWORD -keypass:env ATRIO_QA_CELULAR_KEY_PASSWORD
done

certificate_sha256() {
    keytool -exportcert -alias "$1" -keystore "$keystore" \
        -storepass:env ATRIO_QA_CELULAR_STORE_PASSWORD | sha256sum | cut -d' ' -f1
}
reference="$(certificate_sha256 fixture-a)"
other_reference="$(certificate_sha256 fixture-b)"
test "$reference" != "$other_reference"

bash scripts/qa_geral_celular_manual.sh sign "$unsigned" "$signed" "$keystore"
"$sdk/apksigner" sign --v1-signing-enabled false --v2-signing-enabled true \
    --v3-signing-enabled false --v4-signing-enabled false \
    --ks "$keystore" --ks-key-alias fixture-a \
    --ks-pass env:ATRIO_QA_CELULAR_STORE_PASSWORD --key-pass env:ATRIO_QA_CELULAR_KEY_PASSWORD \
    --next-signer --ks "$keystore" --ks-key-alias fixture-b \
    --ks-pass env:ATRIO_QA_CELULAR_STORE_PASSWORD --key-pass env:ATRIO_QA_CELULAR_KEY_PASSWORD \
    --out "$work/multiple.apk" "$unsigned"
cp -- "$signed" "$work/tampered.apk"
python3 - "$work/tampered.apk" <<'PY'
import sys
from zipfile import ZipFile

with ZipFile(sys.argv[1], "a") as apk:
    apk.writestr("qa-fixture-tampered.txt", "Alteração posterior à assinatura.")
PY

approve() {
    ATRIO_QA_CELULAR_CERT_SHA256="$1" python3 -m scripts.qa_geral_celular_approve \
        --apk "$2" --build-tools "$sdk" --approved-dir "$work/$3"
}

expect_rejected() {
    local scenario="$1" reference="$2" candidate="$3" reason="$4"
    if approve "$reference" "$candidate" "$scenario" > "$work/result.log" 2>&1; then
        echo "Aprovação indevida no cenário $scenario." >&2
        exit 1
    fi
    cat "$work/result.log"
    grep -Fq "$reason" "$work/result.log"
    test ! -e "$work/$scenario"
    echo "$scenario: recusado antes da área de aprovação."
}

expect_rejected referencia-ausente "" "$signed" "SHA-256 de referência ausente"
expect_rejected sem-assinatura "$reference" "$unsigned" "verificacao do APK falhou"
expect_rejected assinatura-invalida "$reference" "$work/tampered.apk" "verificacao do APK falhou"
expect_rejected assinante-extra "$reference" "$work/multiple.apk" "exatamente um assinante"
expect_rejected certificado-divergente "$other_reference" "$signed" "diverge da referência"
approve "$reference" "$signed" aprovado
test ! -e "$signed"
test -s "$work/aprovado/atrio-qa-geral-celular.apk"
"$sdk/aapt" dump xmltree "$work/aprovado/atrio-qa-geral-celular.apk" AndroidManifest.xml > "$work/manifest.txt"
if grep -Fq -e android.permission.INTERNET -e android.permission.REQUEST_INSTALL_PACKAGES \
    -e br.com.atriocatolico.AtrioPushService "$work/manifest.txt"; then
    echo 'O modo fictício perdeu o isolamento no manifesto.' >&2
    exit 1
fi
echo '6 cenários com APKs reais e chaves descartáveis passaram.'
