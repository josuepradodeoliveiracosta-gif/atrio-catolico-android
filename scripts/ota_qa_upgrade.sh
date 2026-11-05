#!/usr/bin/env bash
# QA exclusivamente local/emulador. Nunca usa o keystore permanente ou um APK release.
set -euo pipefail

MODE="${1:-}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
PACKAGE="br.com.atriocatolico"
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
    grep -qx 'val atrioDebugPatch = 7' "$GRADLE_FILE" || fail "Patch de testes mudou; atualizar teste antes de prosseguir"
    gradle :app:assembleDebug --no-daemon
    [[ -s "$APK_PATH" ]] || fail "APK antigo nao encontrado"
    cp "$APK_PATH" "$OUT/atrio-old-debug.apk"
    python3 - <<'PY'
from pathlib import Path
p = Path("app/build.gradle.kts")
data = p.read_text()
assert data.count("val atrioDebugPatch = 7") == 1
p.write_text(data.replace("val atrioDebugPatch = 7",
                          "val atrioDebugPatch = 8", 1))
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
    [[ "$("$analyzer" manifest version-code "$OUT/atrio-old-debug.apk")" == "34" ]] ||
      fail "Codigo de origem incorreto"
    [[ "$("$analyzer" manifest version-code "$OUT/atrio-new-debug.apk")" == "35" ]] ||
      fail "Codigo de destino incorreto"
    old_cert=$("$signer" verify --print-certs "$OUT/atrio-old-debug.apk" |
      sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
    new_cert=$("$signer" verify --print-certs "$OUT/atrio-new-debug.apk" |
      sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
    [[ "$old_cert" =~ ^[0-9a-f]{64}$ && "$old_cert" == "$new_cert" ]] ||
      fail "A chave de testes nao corresponde entre os APKs"
    echo "Dois APKs de QA verificados: pacote identico, mesma assinatura debug, code 34 -> 35."
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
    version_line=$(adb shell dumpsys package "$PACKAGE" | grep -m 1 'versionCode=' || :)
    echo "$version_line" | grep -Eq 'versionCode=35([[:space:]]|$)' ||
      fail "Versao instalada nao aumentou para code 35"
    echo "PASSOU: Android atualizou o mesmo pacote com mesma chave de QA, preservando arquivo local."
    ;;
  *)
    fail "Uso: bash scripts/ota_qa_upgrade.sh build-fixtures|emulator"
    ;;
esac
