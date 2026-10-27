#!/usr/bin/env bash
# Executa dentro do Android Emulator Runner; NUNCA usa ambiente de produção.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ||
      -n "${ATRIO_PUSH_WORKER_URL:-}" ]]; then
  echo "ERRO: variáveis de produção não podem estar presentes no QA Android" >&2
  exit 2
fi
if [[ -e app/google-services.json ]]; then
  echo "ERRO: APK QA não deve incluir google-services.json de produção" >&2
  exit 2
fi

cd tests/security
node prepare.mjs
./node_modules/.bin/firebase emulators:start --only auth,firestore \
  --project demo-atrio-v11 > ../../qa-firebase-emulators.log 2>&1 &
FIREBASE_PID=$!
cleanup() { kill "$FIREBASE_PID" 2>/dev/null || true; }
trap cleanup EXIT

ready=0
for attempt in $(seq 1 90); do
  if ! kill -0 "$FIREBASE_PID" 2>/dev/null; then
    echo "Firebase Emulator Suite encerrou antes de abrir as portas" >&2
    tail -75 ../../qa-firebase-emulators.log || true
    exit 1
  fi
  if curl -s --max-time 1 -o /dev/null http://127.0.0.1:9099/ &&
     curl -s --max-time 1 -o /dev/null http://127.0.0.1:8089/; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  echo "ERRO: Firebase Auth ou Firestore emulado não iniciou" >&2
  tail -75 ../../qa-firebase-emulators.log || true
  exit 1
fi
cd ../..
echo "Iniciando toques e login reais pelo Compose em emulador Android"
gradle :app:connectedDebugAndroidTest --no-daemon --stacktrace
