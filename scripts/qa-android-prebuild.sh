#!/usr/bin/env bash
# Apenas CI: compila APKs Debug em paralelo ao boot do Android virtual.
# O checkout ja deve ter sido isolado de google-services.json e credenciais.
set -euo pipefail
cd "$(dirname "$0")/.."

status_file="qa-android-prebuild.status"
pid_file="qa-android-prebuild.pid"
log_file="qa-android-prebuild.log"
started_file="qa-android-prebuild.started"

case "${1:-}" in
  start)
    if [[ -e "$pid_file" || -e "$status_file" ]]; then
      echo "Prebuild ja foi iniciado neste runner; recusando duplicacao" >&2
      exit 2
    fi
    if [[ -e app/google-services.json ]]; then
      echo "QA offline: google-services.json nao pode entrar no prebuild" >&2
      exit 2
    fi
    date -u +%s > "$started_file"
    (
      set +e
      gradle :app:assembleDebug :app:assembleDebugAndroidTest \
        --daemon --stacktrace --max-workers=2 > "$log_file" 2>&1
      result=$?
      printf '%s\n' "$result" > "${status_file}.tmp"
      mv -- "${status_file}.tmp" "$status_file"
    ) </dev/null >/dev/null 2>&1 &
    echo "$!" > "$pid_file"
    echo "QA Android: prebuild iniciou enquanto Node/Firebase/AVD preparam (PID $(cat "$pid_file"))"
    ;;
  await)
    if [[ ! -f "$pid_file" ]]; then
      echo "QA Android: sem prebuild antecipado; fluxo legado preservado"
      exit 0
    fi
    pid="$(cat "$pid_file")"
    # Timeout maximo de 8 minutos; o job Android possui timeout proprio.
    for attempt in $(seq 1 240); do
      if [[ -s "$status_file" ]]; then
        break
      fi
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "QA Android: prebuild encerrou sem registrar status" >&2
        tail -60 "$log_file" >&2 || true
        exit 1
      fi
      sleep 2
    done
    if [[ ! -s "$status_file" ]]; then
      echo "QA Android: prebuild excedeu oito minutos" >&2
      tail -60 "$log_file" >&2 || true
      exit 1
    fi
    result="$(cat "$status_file")"
    if [[ "$result" != 0 ]]; then
      echo "QA Android: prebuild falhou, status=$result" >&2
      tail -80 "$log_file" >&2 || true
      exit 1
    fi
    echo "QA Android: prebuild aprovado antes da instrumentacao"
    grep 'BUILD SUCCESSFUL' "$log_file" | tail -1 || true
    if [[ -f "$started_file" ]]; then
      began="$(cat "$started_file")"
      ended="$(date -u +%s)"
      if [[ "$began" =~ ^[0-9]+$ ]]; then
        echo "QA Android: tempo de prebuild ate a verificacao = $((ended - began))s"
      fi
    fi
    ;;
  *)
    echo "Uso: bash scripts/qa-android-prebuild.sh start|await" >&2
    exit 2
    ;;
esac
