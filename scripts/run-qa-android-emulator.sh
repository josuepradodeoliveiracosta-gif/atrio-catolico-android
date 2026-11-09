#!/usr/bin/env bash
# Executa dentro do Android Emulator Runner; NUNCA usa ambiente de produção.
set -euo pipefail
cd "$(dirname "$0")/.."
qa_group="${ATRIO_QA_SUITE_GROUP:-all}"
case "$qa_group" in
  all|profiles|interaction|bots) ;;
  *) echo "Grupo QA desconhecido: $qa_group" >&2; exit 2 ;;
esac
if [[ -n "${ATRIO_QA_SUITE:-}" && "$qa_group" != all ]]; then
  echo "Suite focal e grupo paralelo nao podem ser combinados" >&2; exit 2
fi
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
  # Modo all preserva as 15 suites; cada grupo executa somente suas suites.
  if [[ "$qa_group" != "all" ]]; then
    case "$qa_group:$suite" in
      profiles:GuardianSessionUiTest|profiles:ProfileLayoutUiTest|profiles:ProfilePhotoUiTest|\
      profiles:ProfileEditorUiTest|profiles:DesignV2UiTest|profiles:EmailVerificationAndroidUiTest|\
      interaction:EngagementUiTest|interaction:ReactionEmojiUiTest|\
      interaction:DiscussionDetailV2UiTest|interaction:AtrioTypographyAccessibilityUiTest|\
      bots:ThreeBotsAndroidUiTest|bots:ThreeBotsAuthenticatedAndroidUiTest|\
      bots:ThreeBotsOnlineEmulatorTest|bots:AtrioConversationsEmulatorUiTest|\
      bots:AtrioGroupsEmulatorUiTest) ;;
      *) echo "QA Android: $suite executada por outro grupo"; return 0 ;;
    esac
  fi
  local full="br.com.atriocatolico.$suite"
  echo "QA Android: iniciando $suite (isolado)"
  if gradle :app:connectedDebugAndroidTest \
    "-Pandroid.testInstrumentationRunnerArguments.class=$full" \
    --daemon --stacktrace; then
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
  # Extrair somente marcadores permitidos da instrumentacao Auth/Firestore
  # dos bots: jamais anexar logcat bruto que pode conter dados sensiveis.
  if [[ "$suite" == "ThreeBotsAuthenticatedAndroidUiTest" ]]; then
    local markers="qa-android-suite-results/$suite/profile-write-markers.txt"
    mkdir -p "qa-android-suite-results/$suite"
    if adb logcat -d -v raw -s AtrioQaProfile:I '*:S' 2>/dev/null \
      | grep -Eo 'auth_signup_callback_received|profile_write_requested|profile_write_acknowledged|profile_write_rejected:[A-Za-z_]+' \
      | tail -n 100 > "$markers"; then
      echo "QA Android: marcadores sanitizados coletados: $(wc -l < "$markers")"
    else
      printf '%s\n' 'qa_profile_markers_unavailable' > "$markers"
      echo "QA Android: marcadores indisponiveis (nao comprova persistencia)"
    fi
  fi
}
# Suite-only QA V2: reuse the existing isolated emulator/auth startup,
# but never repeat the nine older Android UI suites for this new check.
if [[ "${ATRIO_QA_SUITE:-}" == "GuardianV2UiTest" ]]; then
  run_suite GuardianV2UiTest
  echo "QA Android: apenas GuardianV2UiTest; status=$qa_failed"
  exit "$qa_failed"
fi
# Execucao opcional dirigida do emulador, jamais combinada com matrix paralelo.
# A workflow normal de PR segue executando os tres grupos completos.
if [[ -n "${ATRIO_QA_SUITE:-}" ]]; then
  case "$ATRIO_QA_SUITE" in
    ThreeBotsOnlineEmulatorTest|ThreeBotsAuthenticatedAndroidUiTest) ;;
    AtrioConversationsEmulatorUiTest|AtrioGroupsEmulatorUiTest)
      (cd tests/security && node seed-chat-groups-android.mjs) ;;
    *) echo "Suite seletiva desconhecida; negando execucao" >&2; exit 2 ;;
  esac
  run_suite "$ATRIO_QA_SUITE"
  echo "QA Android: apenas $ATRIO_QA_SUITE; status=$qa_failed"
  exit "$qa_failed"
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
run_suite EmailVerificationAndroidUiTest
# Conversas e grupos so pertencem ao grupo bots, com dados exclusivamente
# sinteticos e resets independentes das fixtures entre as duas suites.
if [[ "$qa_group" == "all" || "$qa_group" == "bots" ]]; then
  (cd tests/security && node seed-chat-groups-android.mjs)
fi
run_suite AtrioConversationsEmulatorUiTest
if [[ "$qa_group" == "all" || "$qa_group" == "bots" ]]; then
  (cd tests/security && node seed-chat-groups-android.mjs)
fi
run_suite AtrioGroupsEmulatorUiTest
echo "QA Android: suítes concluídas em processos separados; status=$qa_failed"
exit "$qa_failed"
