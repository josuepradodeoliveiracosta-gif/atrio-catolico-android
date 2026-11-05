#!/usr/bin/env bash
# QA: same OTA code as production, private loopback fixtures, NEVER signed release.
set -euo pipefail

[[ "${ATRIO_OTA_QA_LOOPBACK:-0}" == "1" ]] || {
  echo "::error::Canal OTA QA desativado: export ATRIO_OTA_QA_LOOPBACK=1" >&2
  exit 1
}
[[ -n "${ANDROID_HOME:-}" ]] || { echo "Android SDK ausente" >&2; exit 1; }

PACKAGE='br.com.atriocatolico.otalab'
OUT="${RUNNER_TEMP:-/tmp}/atrio-ota-upgrade-qa"
OLD="$OUT/atrio-old-debug.apk"
NEW="$OUT/atrio-new-debug.apk"
INSTRUMENTATION='app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
OUTPUT="$OUT/ota-in-app-instrumentation.txt"

case "${1:-}" in
  prepare)
    [[ -s "$OLD" && -s "$NEW" ]] || { echo "Fixtures ausentes" >&2; exit 1; }
    python3 scripts/ota_qa_loopback_server.py \
      --apk "$NEW" --sdk "$ANDROID_HOME" \
      --write-manifest "$OUT/update.json" --verify-only
    python3 scripts/ota_qa_loopback_server.py \
      --apk "$NEW" --manifest "$OUT/update.json" --verify-only
    ;;
  emulator)
    [[ -s "$OLD" && -s "$NEW" && -s "$INSTRUMENTATION" ]] ||
      { echo "::error::Faltam APKs ou APK AndroidTest" >&2; exit 1; }
    mkdir -p "$OUT"
    # AOSP sem Play Services; permite QA local com APKs assinados pelo runner.
    adb shell settings put global package_verifier_enable 0
    adb shell settings put global verifier_verify_adb_installs 0
    adb install --no-streaming "$OLD"
    adb shell run-as "$PACKAGE" mkdir -p files
    adb shell run-as "$PACKAGE" touch files/ota-lab-preserved
    adb reverse tcp:8765 tcp:8765

    python3 scripts/ota_qa_loopback_server.py \
      --apk "$NEW" --manifest "$OUT/update.json" > "$OUT/server.log" 2>&1 &
    SERVER_PID=$!
    trap 'kill "$SERVER_PID" 2>/dev/null || :; wait "$SERVER_PID" 2>/dev/null || :' EXIT
    ready=false
    for attempt in $(seq 1 35); do
      if curl --noproxy '*' -fsS http://127.0.0.1:8765/releases/latest > "$OUT/release.json"; then
        ready=true
        break
      fi
      sleep 1
    done
    [[ "$ready" == "true" ]] || { echo "Servidor loopback nao iniciou" >&2; cat "$OUT/server.log"; exit 1; }
    adb install --no-streaming "$INSTRUMENTATION"

    # O teste abre a tela REAL do cliente OTA, consulta, baixa, verifica
    # tamanho, hash, pacote, versionCode e certificado, até o botão Instalar.
    # Ele NAO confirma instalação do Android (exige consentimento).
    adb shell am instrument -w -r \
      -e class br.com.atriocatolico.OtaQaLoopbackUiTest \
      "$PACKAGE.test/br.com.atriocatolico.QaAndroidTestRunner" | tee "$OUTPUT"
    grep -q 'OK (1 test)' "$OUTPUT" || {
      echo "::error::O app nao comprovou download OTA verificado"; exit 1;
    }

    # Prova de upgrade do MESMO pacote com ADB; distinta de instalar pelo app.
    adb install -r --no-streaming "$NEW"
    adb shell run-as "$PACKAGE" ls files/ota-lab-preserved >/dev/null
    installed=$(adb shell dumpsys package "$PACKAGE" | grep -m 1 'versionCode=' || :)
    echo "$installed" | grep -Eq 'versionCode=35([[:space:]]|$)' || {
      echo "::error::Android nao confirmou QA versionCode=35"; exit 1;
    }
    echo "PASSOU: consulta e download na UI, verificacao do APK e instalacao -r em QA. Instalação pelo toque no Android ainda precisa de homologacao real."
    ;;
  *)
    echo "Uso: bash scripts/ota_qa_in_app.sh prepare|emulator" >&2
    exit 2
    ;;
esac
