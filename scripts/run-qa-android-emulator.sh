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
  # Isolamento da VM efêmera do GitHub Actions. NÃO modifica o repositório:
  # remove apenas o arquivo da cópia local temporária do runner.
  echo "Isolando Android QA: retirando google-services.json apenas da VM de CI"
  rm -- app/google-services.json
fi
test ! -e app/google-services.json || {
  echo "Falha ao isolar a configuração Firebase do APK de testes" >&2
  exit 2
}

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

# A suíte de login Android precisa de um processo Firebase/Auth limpo entre
# cenários. Não reutilizar listeners e credenciais em testes E2E separados:
# uma troca de conta ainda em trânsito pode deixar avisos invisíveis.
# Cada invocation cria um AndroidJUnitRunner novo no MESMO emulador local.
mkdir -p qa-android-suite-results
run_suite() {
  local suite="$1"
  local full="br.com.atriocatolico.$suite"
  echo "QA Android: iniciando $suite (isolado)"
  gradle :app:connectedDebugAndroidTest \
    "-Pandroid.testInstrumentationRunnerArguments.class=$full" \
    --no-daemon --stacktrace
  if [[ -d app/build/outputs/androidTest-results/connected/debug ]]; then
    mkdir -p "qa-android-suite-results/$suite"
    cp -a app/build/outputs/androidTest-results/connected/debug/. \
      "qa-android-suite-results/$suite/"
  fi
}
run_suite ThreeBotsAndroidUiTest
run_suite ThreeBotsAuthenticatedAndroidUiTest
run_suite ThreeBotsOnlineEmulatorTest
echo "QA Android: três suítes concluídas com êxito em processos separados"
