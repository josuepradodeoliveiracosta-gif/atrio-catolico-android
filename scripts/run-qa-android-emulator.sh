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
# O gateway QEMU 10.0.2.2 pode ficar inacessível em alguns runners CI.
# Encaminhar localhost do próprio emulador ao Auth/Firestore de teste na VM.
# É um túnel exclusivamente local do ADB: nenhuma chamada a produção.
curl -fsS --max-time 3 http://127.0.0.1:9099/ >/dev/null
curl -fsS --max-time 3 http://127.0.0.1:8089/ >/dev/null
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8089 tcp:8089
echo "Firebase QA: portas 9099/8089 encaminhadas via ADB reverse (localhost)"
adb reverse --list
echo "Iniciando toques e login reais pelo Compose em emulador Android"

# A suíte de login Android precisa de um processo Firebase/Auth limpo entre
# cenários. Não reutilizar listeners e credenciais em testes E2E separados:
# uma troca de conta ainda em trânsito pode deixar avisos invisíveis.
# Cada invocation cria um AndroidJUnitRunner novo no MESMO emulador local.
mkdir -p qa-android-suite-results
qa_failed=0
run_suite() {
  local suite="$1"
  local full="br.com.atriocatolico.$suite"
  echo "QA Android: iniciando $suite (isolado)"
  if gradle :app:connectedDebugAndroidTest \
    "-Pandroid.testInstrumentationRunnerArguments.class=$full" \
    --no-daemon --stacktrace; then
    echo "QA Android: $suite aprovada"
  else
    qa_failed=1
    echo "QA Android: $suite falhou; preservando relatório e executando as demais"
  fi
  if [[ -d app/build/outputs/androidTest-results/connected/debug ]]; then
    mkdir -p "qa-android-suite-results/$suite"
    cp -a app/build/outputs/androidTest-results/connected/debug/. \
      "qa-android-suite-results/$suite/"
  fi
}
run_suite ProfileLayoutUiTest
mkdir -p qa-android-suite-results/profile-preview
if ! adb pull /data/local/tmp/atrio-profile-preview/. qa-android-suite-results/profile-preview/; then
  qa_failed=1
  echo "Falha ao coletar capturas; as outras suítes continuarão"
fi
run_suite ProfileEditorUiTest
run_suite ThreeBotsAndroidUiTest
run_suite ThreeBotsAuthenticatedAndroidUiTest
run_suite ThreeBotsOnlineEmulatorTest
echo "QA Android: suítes concluídas em processos separados; status=$qa_failed"
exit "$qa_failed"
