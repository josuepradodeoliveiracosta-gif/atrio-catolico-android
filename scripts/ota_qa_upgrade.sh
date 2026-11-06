#!/usr/bin/env bash
# QA exclusivamente local/emulador. Nunca usa o keystore permanente ou um APK release.
set -euo pipefail

MODE="${1:-}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
# O canal experimental usa pacote separado; a QA legada continua identica.
PACKAGE="br.com.atriocatolico"
if [[ "${ATRIO_OTA_QA_LOOPBACK:-0}" == "1" ]]; then
  PACKAGE="br.com.atriocatolico.otalab"
fi
OUT="${RUNNER_TEMP:-/tmp}/atrio-ota-upgrade-qa"
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
GRADLE_FILE="app/build.gradle.kts"

fail() { echo "::error::OTA upgrade QA: $*" >&2; exit 1; }

case "$MODE" in
  build-fixtures)
    [[ -n "$SDK" ]] || fail "ANDROID_HOME ausente"
    mkdir -p "$OUT"
    [[ -f "$GRADLE_FILE" ]] || fail "Gradle nao encontrado"
    # Nunca altere um numero de release; modifique somente a copia efemera do patch debug.
    # Descubra o patch atual, sem acoplar o laboratório a uma versão fixa.
    old_patch=$(sed -nE 's/^val atrioDebugPatch = ([0-9]+)$/\1/p' "$GRADLE_FILE")
    [[ "$old_patch" =~ ^[0-9]+$ ]] || fail "Patch Debug ausente ou inválido"
    grep -Fqx 'val atrioDebugVersionCode = 27 + atrioDebugPatch' "$GRADLE_FILE" ||
      fail "Fórmula do versionCode Debug mudou; revisar manualmente"
    new_patch=$((old_patch + 1))
    old_code=$((27 + old_patch))
    new_code=$((old_code + 1))
    printf '%s\n' "$old_code" > "$OUT/old-code.txt"
    printf '%s\n' "$new_code" > "$OUT/new-code.txt"
    gradle :app:assembleDebug --no-daemon
    [[ -s "$APK_PATH" ]] || fail "APK antigo nao encontrado"
    cp "$APK_PATH" "$OUT/atrio-old-debug.apk"
    ATRIO_OLD_DEBUG_PATCH="$old_patch" ATRIO_NEW_DEBUG_PATCH="$new_patch" python3 - <<'PY'
import os
from pathlib import Path
p = Path("app/build.gradle.kts")
data = p.read_text()
old = f"val atrioDebugPatch = {os.environ['ATRIO_OLD_DEBUG_PATCH']}"
new = f"val atrioDebugPatch = {os.environ['ATRIO_NEW_DEBUG_PATCH']}"
assert data.count(old) == 1
p.write_text(data.replace(old, new, 1))
PY
    gradle :app:assembleDebug --no-daemon
    [[ -s "$APK_PATH" ]] || fail "APK novo nao encontrado"
    cp "$APK_PATH" "$OUT/atrio-new-debug.apk"
    analyzer="$SDK/cmdline-tools/latest/bin/apkanalyzer"
    signer="$SDK/build-tools/35.0.0/apksigner"
    for apk in "$OUT/atrio-old-debug.apk" "$OUT/atrio-new-debug.apk"; do
      [[ "$("$analyzer" manifest application-id "$apk")" == "$PACKAGE" ]] ||
        fail "Identificador diferente do Atrio"
      "$signer" verify "$apk" || fail "Assinatura invalida"
    done
    [[ "$("$analyzer" manifest version-code "$OUT/atrio-old-debug.apk")" == "$old_code" ]] ||
      fail "Código de origem incorreto: esperado $old_code"
    [[ "$("$analyzer" manifest version-code "$OUT/atrio-new-debug.apk")" == "$new_code" ]] ||
      fail "Código de destino incorreto: esperado $new_code"
    old_cert=$("$signer" verify --print-certs "$OUT/atrio-old-debug.apk" |
      sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
    new_cert=$("$signer" verify --print-certs "$OUT/atrio-new-debug.apk" |
      sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
    [[ "$old_cert" =~ ^[0-9a-f]{64}$ && "$old_cert" == "$new_cert" ]] ||
      fail "A chave de testes nao corresponde entre os APKs"
    echo "Dois APKs de QA verificados: pacote idêntico, mesma assinatura Debug, code $old_code -> $new_code."
    ;;
  emulator)
    [[ -s "$OUT/atrio-old-debug.apk" && -s "$OUT/atrio-new-debug.apk" ]] ||
      fail "Fixtures nao disponiveis"
    # Apenas no emulador efemero AOSP: nao depender de verificacao online
    # da loja/servico de integridade para um APK debug assinado localmente.
    adb shell settings put global package_verifier_enable 0
    adb shell settings put global verifier_verify_adb_installs 0
    adb install --no-streaming "$OUT/atrio-old-debug.apk" ||
      fail "Falha na instalacao inicial"
    adb shell run-as "$PACKAGE" mkdir -p files ||
      fail "Nao foi possivel criar pasta privada"
    adb shell run-as "$PACKAGE" touch files/ota-qa-sentinel ||
      fail "Nao foi possivel gravar dado local"
    adb install -r --no-streaming "$OUT/atrio-new-debug.apk" ||
      fail "O Android nao aceitou atualizar por cima"
    adb shell run-as "$PACKAGE" ls files/ota-qa-sentinel >/dev/null ||
      fail "Dado privado foi perdido"
    [[ -s "$OUT/new-code.txt" ]] || fail "Código de destino ausente"
    expected_code=$(cat "$OUT/new-code.txt")
    [[ "$expected_code" =~ ^[0-9]+$ ]] || fail "Código de destino inválido"
    version_line=$(adb shell dumpsys package "$PACKAGE" | grep -m 1 'versionCode=' || :)
    echo "$version_line" | grep -Eq "versionCode=${expected_code}([[:space:]]|$)" ||
      fail "Versão instalada não aumentou para code $expected_code"
    echo "PASSOU: Android atualizou o mesmo pacote com mesma chave de QA, preservando arquivo local."
    ;;
  *)
    fail "Uso: bash scripts/ota_qa_upgrade.sh build-fixtures|emulator"
    ;;
esac
