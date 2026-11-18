#!/usr/bin/env bash
# Executa dentro do Android Emulator Runner; NUNCA usa ambiente de produção.
set -euo pipefail
cd "$(dirname "$0")/.."
qa_group="${ATRIO_QA_SUITE_GROUP:-all}"
qa_apk="${ATRIO_QA_APK:-debug}"
case "$qa_apk" in
  debug|qaGeral) ;;
  *) echo "Variante de instrumentacao nao permitida: $qa_apk" >&2; exit 2 ;;
esac
# Bots completos so no APK QA Geral, com Auth/Firestore Emulator.
if [[ "$qa_group" == "bots" || ( "$qa_group" == "all" && -z "${ATRIO_QA_SUITE:-}" ) ]]; then
  [[ "$qa_apk" == "qaGeral" ]] || {
    echo "Tres bots completos: permitido somente APK QA Geral" >&2
    exit 2
  }
fi
if [[ "$qa_apk" == "qaGeral" ]]; then
  [[ "${ATRIO_QA_GERAL_BUILD:-}" == "1" &&
     "${ATRIO_QA_FIREBASE_PROJECT:-}" == "demo-atrio-v11" ]] || {
    echo "APK QA Geral exige build isolado e projeto demo-atrio-v11" >&2
    exit 2
  }
  test_task=":app:connectedQaGeralAndroidTest"
else
  test_task=":app:connectedDebugAndroidTest"
fi
case "$qa_group" in
  all|profiles|interaction|bots) ;;
  *) echo "Grupo QA desconhecido: $qa_group" >&2; exit 2 ;;
esac
if [[ "${ATRIO_QA_GERAL_CELULAR_PILOT:-}" == 1 ]]; then
  [[ "$qa_apk" == "qaGeral" && "${ATRIO_QA_SUITE:-}" == "AtrioConversasCompostasEmulatorUiTest" ]] || {
    echo "Piloto QA Celular: somente a suíte de Conversas e Grupos no Emulator" >&2
    exit 2
  }
fi
if [[ -n "${ATRIO_QA_SUITE:-}" && "$qa_group" != all ]]; then
  echo "Suite focal e grupo paralelo nao podem ser combinados" >&2; exit 2
fi
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ||
      -n "${ATRIO_PUSH_WORKER_URL:-}" ]]; then
  echo "ERRO: variáveis de produção não podem estar presentes no QA Android" >&2
  exit 2
fi
for config in app/src/qaGeral/google-services.json app/src/chatQa/google-services.json app/src/perfilQa/google-services.json; do
  if [[ -e "$config" && "$qa_apk" == "qaGeral" ]]; then
    echo "APK QA Geral nao admite configuracoes de outras variantes" >&2
    exit 2
  fi
done
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
curl -sS --max-time 3 -o /dev/null http://127.0.0.1:9099/
curl -sS --max-time 3 -o /dev/null http://127.0.0.1:8089/
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8089 tcp:8089
echo "Firebase QA: portas 9099/8089 encaminhadas via ADB reverse (localhost)"
adb reverse --list
echo "Iniciando toques e login reais pelo Compose em emulador Android"
# Espera o build iniciado antes do boot; sem PID (Guardiao V2 focal), segue legado.
# Nunca executar o Gradle de instrumentacao em paralelo com a precompilacao.
bash scripts/qa-android-prebuild.sh await

# A suíte de login Android precisa de um processo Firebase/Auth limpo entre
# cenários. Não reutilizar listeners e credenciais em testes E2E separados:
# uma troca de conta ainda em trânsito pode deixar avisos invisíveis.
# Cada invocation cria um AndroidJUnitRunner novo no MESMO emulador local.
mkdir -p qa-android-suite-results
qa_failed=0
run_suite() {
  local suite="$1"
  # Modo all preserva a ordem das suites; cada grupo so roda as suas.
  if [[ "$qa_group" != "all" ]]; then
    case "$qa_group:$suite" in
      profiles:GuardianSessionUiTest|profiles:ProfileLayoutUiTest|profiles:ProfilePhotoUiTest|\
      profiles:ProfileEditorUiTest|profiles:DesignV2UiTest|profiles:EmailVerificationAndroidUiTest|\
      profiles:PerfilQaSaveEmulatorTest|\
      interaction:EngagementUiTest|interaction:ReactionEmojiUiTest|\
      interaction:DiscussionDetailV2UiTest|interaction:AtrioTypographyAccessibilityUiTest|\
      bots:ThreeBotsAndroidUiTest|bots:ThreeBotsAuthenticatedAndroidUiTest|\
      bots:ThreeBotsOnlineEmulatorTest|bots:AtrioConversasCompostasEmulatorUiTest|\
      bots:AtrioConversasNavegacaoEmulatorUiTest|bots:AtrioConversasForaDaConfiguracaoEmulatorUiTest) ;;
      *) echo "QA Android: $suite executada por outro grupo"; return 0 ;;
    esac
  fi
  case "$suite" in
    ThreeBots*|AtrioConversas*)
      [[ "$qa_apk" == "qaGeral" ]] || {
        echo "Suite de bot recusada fora do APK QA Geral" >&2
        exit 2
      } ;;
  esac
  local full="br.com.atriocatolico.$suite"
  echo "QA Android: iniciando $suite (isolado)"
  if gradle "$test_task" \
    "-Pandroid.testInstrumentationRunnerArguments.class=$full" \
    --daemon --stacktrace; then
    echo "QA Android: $suite aprovada"
  else
    qa_failed=1
    echo "QA Android: $suite falhou; preservando relatório e executando as demais"
  fi
  local results="app/build/outputs/androidTest-results/connected/$qa_apk"
  if [[ -d "$results" ]]; then
    mkdir -p "qa-android-suite-results/$suite"
    cp -a "$results/." "qa-android-suite-results/$suite/"
  fi
}
# Suite-only QA V2: reuse the existing isolated emulator/auth startup,
# but never repeat the nine older Android UI suites for this new check.
if [[ "${ATRIO_QA_SUITE:-}" == "GuardianV2UiTest" ]]; then
  run_suite GuardianV2UiTest
  echo "QA Android: apenas GuardianV2UiTest; status=$qa_failed"
  exit "$qa_failed"
fi
if [[ "${ATRIO_QA_GERAL_CELULAR_PILOT:-}" == 1 ]]; then
  (cd tests/security && node seed-qa-celular-pilot-android.mjs)
  run_suite "$ATRIO_QA_SUITE"
  exit "$qa_failed"
fi
if [[ -n "${ATRIO_QA_SUITE:-}" ]]; then
  echo "Suite seletiva desconhecida; negando execucao" >&2
  exit 2
fi
run_suite GuardianSessionUiTest
run_suite ProfileLayoutUiTest
run_suite ProfilePhotoUiTest
run_suite EngagementUiTest
run_suite ReactionEmojiUiTest
# Regressões da discussão V2: compositor, ordenação, menus e densidade visual.
run_suite DiscussionDetailV2UiTest
# Fonte ampliada sem dados de produção: compositor 200%, navegação 160%.
run_suite AtrioTypographyAccessibilityUiTest
# Capturas vinculadas ao grupo que produziu cada evidencia.
if [[ "$qa_group" == "all" || "$qa_group" == "interaction" ]]; then
  mkdir -p qa-android-suite-results/reaction-preview
  if ! adb pull /data/local/tmp/atrio-reaction-preview/. qa-android-suite-results/reaction-preview/; then
    qa_failed=1
    echo "Falha ao coletar capturas de reações; as outras suítes continuarão"
  fi
fi
if [[ "$qa_group" == "all" || "$qa_group" == "profiles" ]]; then
  mkdir -p qa-android-suite-results/profile-preview
  if ! adb pull /data/local/tmp/atrio-profile-preview/. qa-android-suite-results/profile-preview/; then
    qa_failed=1
    echo "Falha ao coletar capturas; as outras suítes continuarão"
  fi
fi
run_suite ProfileEditorUiTest
# Guia visual v2: casos de categorias, busca, falha e feedback de salvamento.
run_suite DesignV2UiTest
run_suite ThreeBotsAndroidUiTest
run_suite ThreeBotsAuthenticatedAndroidUiTest
run_suite ThreeBotsOnlineEmulatorTest
if [[ "$qa_group" == "all" || "$qa_group" == "bots" ]]; then
  # Carregar as Rules candidatas só depois dos bots, no mesmo emulador local.
  node --test firebase/qa-general/compose-parity-rules.test.mjs
  node firebase/qa-general/compose-parity-rules.mjs
  sha256sum tests/security/qa-parity.generated.rules
  (cd tests/security && node seed-chat-groups-android.mjs --navegacao-perfis)
  adb reverse tcp:18089 tcp:8089
fi
run_suite AtrioConversasCompostasEmulatorUiTest
run_suite AtrioConversasNavegacaoEmulatorUiTest
run_suite AtrioConversasForaDaConfiguracaoEmulatorUiTest
run_suite EmailVerificationAndroidUiTest
if [[ "$qa_group" == "all" || "$qa_group" == "profiles" ]]; then
  # Só a última suíte usa a política restritiva. As suítes anteriores
  # continuam no mesmo emulador local com as Rules gerais.
  jq -n --rawfile rules firebase/qa-perfil/firestore.rules \
    '{rules:{files:[{name:"firestore.rules",content:$rules}]}}' |
    curl --fail-with-body --silent --show-error --max-time 10 -X PUT \
      -H 'Content-Type: application/json' --data-binary @- \
      http://127.0.0.1:8089/emulator/v1/projects/demo-atrio-v11:securityRules
  run_suite PerfilQaSaveEmulatorTest
fi
echo "QA Android: suítes concluídas em processos separados; status=$qa_failed"
exit "$qa_failed"
