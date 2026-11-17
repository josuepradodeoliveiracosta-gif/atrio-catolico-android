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
for code in 38 39; do
    bash scripts/qa_geral_celular_manual.sh build "$work/unsigned-$code.apk" "$code"
done

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

for code in 38 39; do
    bash scripts/qa_geral_celular_manual.sh sign "$work/unsigned-$code.apk" "$work/signed-$code.apk" "$keystore"
done
ATRIO_QA_CELULAR_KEY_ALIAS=fixture-b bash scripts/qa_geral_celular_manual.sh sign \
    "$work/unsigned-39.apk" "$work/other-39.apk" "$keystore"

approve_pair() {
    ATRIO_QA_CELULAR_CERT_SHA256="$reference" python3 -m scripts.qa_geral_celular_approve \
        --apk "$work/$1" --update-apk "$work/$2" \
        --build-tools "$sdk" --approved-dir "$work/$3"
}

expect_pair_rejected() {
    local scenario="$1" base="$2" update="$3" reason="$4"
    if approve_pair "$base" "$update" "$scenario" > "$work/result.log" 2>&1; then
        echo "Aprovação indevida do par no cenário $scenario." >&2
        exit 1
    fi
    cat "$work/result.log"
    grep -Fq "$reason" "$work/result.log"
    test ! -e "$work/$scenario"
    echo "$scenario: recusado sem aprovar nenhum APK."
}

expect_pair_rejected par-invertido signed-39.apk signed-38.apk "versionCode 38 → 39"
expect_pair_rejected par-repetido signed-38.apk signed-38.apk "versionCode 38 → 39"
expect_pair_rejected par-certificado-divergente signed-38.apk other-39.apk "diverge da referência"
approve_pair signed-38.apk signed-39.apk par-aprovado
for code in 38 39; do
    apk="$work/par-aprovado/atrio-qa-geral-celular-$code.apk"
    test -s "$apk"
    "$sdk/aapt" dump badging "$apk" > "$work/badging-$code.txt"
    grep -F "package: name='br.com.atriocatolico.qageral.celular' versionCode='$code' " "$work/badging-$code.txt"
    grep -F "application-label:'Átrio QA Celular · Atualização'" "$work/badging-$code.txt"
    "$sdk/aapt" dump xmltree "$apk" AndroidManifest.xml > "$work/manifest-$code.txt"
    grep -Eq 'android:allowBackup[^=]*=.*0x0$' "$work/manifest-$code.txt"
    if grep -Fq -e android.permission.INTERNET -e android.permission.REQUEST_INSTALL_PACKAGES \
        -e android.permission.POST_NOTIFICATIONS -e br.com.atriocatolico.AtrioPushService "$work/manifest-$code.txt"; then
        echo "O APK $code perdeu o isolamento do modo fictício." >&2
        exit 1
    fi
done
echo '4 cenários de atualização com APKs reais e chaves descartáveis passaram.'

age-keygen -o "$work/recipient.agekey" 2>/dev/null
age-keygen -o "$work/other.agekey" 2>/dev/null
recipient="$(age-keygen -y "$work/recipient.agekey")"
source_sha="$(git rev-parse HEAD)"

deliver_pair() {
    ATRIO_QA_CELULAR_AGE_RECIPIENT="$1" ATRIO_QA_CELULAR_CERT_SHA256="$reference" \
        python3 -m scripts.qa_geral_celular_delivery --approved-dir "$work/$2" \
        --output "$work/$3.zip.age" --source-sha "$source_sha"
}

if deliver_pair "" par-aprovado sem-destinatario; then
    echo 'Cifra aprovada sem destinatário.' >&2
    exit 1
fi
test ! -e "$work/sem-destinatario.zip.age"
mkdir "$work/par-incompleto"
cp -- "$work/par-aprovado/atrio-qa-geral-celular-38.apk" "$work/par-incompleto/"
if deliver_pair "$recipient" par-incompleto sem-segundo-apk; then
    echo 'Cifra aprovada com par incompleto.' >&2
    exit 1
fi
test ! -e "$work/sem-segundo-apk.zip.age"

deliver_pair "$recipient" par-aprovado entrega
if age --decrypt --identity "$work/other.agekey" "$work/entrega.zip.age" >/dev/null 2>&1; then
    echo 'Outro destinatário conseguiu decifrar o pacote.' >&2
    exit 1
fi
age --decrypt --identity "$work/recipient.agekey" --output "$work/conferir.zip" "$work/entrega.zip.age"
python3 - "$work" "$source_sha" "$reference" <<'PY'
from hashlib import sha256
from pathlib import Path
import json
import sys
from zipfile import ZipFile

work = Path(sys.argv[1])
with ZipFile(work / "conferir.zip") as bundle:
    filenames = [f"atrio-qa-geral-celular-{code}.apk" for code in (38, 39)]
    assert sorted(bundle.namelist()) == sorted(filenames + ["ORIGEM.json", "SHA256SUMS"])
    metadata = json.loads(bundle.read("ORIGEM.json"))
    assert metadata["source_sha"] == sys.argv[2]
    assert metadata["applicationId"] == "br.com.atriocatolico.qageral.celular"
    assert metadata["certificate_sha256"] == sys.argv[3]
    assert [(apk["file"], apk["versionCode"]) for apk in metadata["apks"]] == list(zip(filenames, (38, 39)))
    expected_sums = ""
    for apk in metadata["apks"]:
        filename = apk["file"]
        original = (work / "par-aprovado" / filename).read_bytes()
        assert bundle.read(filename) == original
        digest = sha256(original).hexdigest()
        assert apk["sha256"] == digest
        expected_sums += f"{digest}  {filename}\n"
    assert bundle.read("SHA256SUMS").decode() == expected_sums
PY
echo 'Entrega cifrada conferida: SHA, APKs e hashes íntegros; outro destinatário não decifra.'

if [[ $# == 1 ]]; then
    # Somente no runner do CI, depois de conferir assinatura e conteúdo.
    mkdir -m 700 -- "$1"
    cp -- "$work/aprovado/atrio-qa-geral-celular.apk" "$1/37.apk"
    cp -- "$work/par-aprovado/atrio-qa-geral-celular-38.apk" "$1/38.apk"
    cp -- "$work/par-aprovado/atrio-qa-geral-celular-39.apk" "$1/39.apk"
fi
