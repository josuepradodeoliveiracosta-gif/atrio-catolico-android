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
inbox_focal=0
if [[ "${ATRIO_QA_SUITE:-}" == AtrioInboxDiscoveryEmulatorUiTest ]]; then
  [[ "$qa_apk" == qaGeral && "${ATRIO_QA_INBOX_DISCOVERY:-}" == 1 &&
     "${ATRIO_QA_GERAL_REMOTE_BUILD:-}" != 1 &&
     "${ATRIO_QA_GERAL_CELULAR_PILOT:-}" != 1 ]] || {
    echo "Descoberta da inbox exige qaGeral local com opt-in" >&2
    exit 2
  }
  inbox_focal=1
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
if [[ "$inbox_focal" == 1 ]]; then
  node ../../firebase/qa-general/compose-parity-rules.mjs
  cp qa-parity.generated.rules firestore.rules
  sha256sum firestore.rules
fi
./node_modules/.bin/firebase emulators:start --only auth,firestore \
  --project demo-atrio-v11 > ../../qa-firebase-emulators.log 2>&1 &
FIREBASE_PID=$!
inbox_pid=
profile_worker_pid=
profile_tls_dir=
cleanup() {
  if [[ -n "$inbox_pid" ]]; then kill "$inbox_pid" 2>/dev/null || true; fi
  if [[ -n "$profile_worker_pid" ]]; then kill "$profile_worker_pid" 2>/dev/null || true; fi
  if [[ -n "$profile_tls_dir" ]]; then
    adb reverse --remove tcp:8094 >/dev/null 2>&1 || true
    rm -f -- "$profile_tls_dir/key.pem" "$profile_tls_dir/cert.pem"
    rmdir -- "$profile_tls_dir"
  fi
  kill "$FIREBASE_PID" 2>/dev/null || true
}
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
  shift
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
      bots:AtrioConversasNavegacaoEmulatorUiTest|bots:AtrioConversasForaDaConfiguracaoEmulatorUiTest|\
      bots:AtrioConversasTrocaContaEmulatorUiTest) ;;
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
    "-Pandroid.testInstrumentationRunnerArguments.class=$full" "$@" \
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
if [[ "${ATRIO_QA_SUITE:-}" == ProfileV3ConsentEmulatorUiTest ]]; then
  [[ "$qa_apk" == qaGeral && "${ATRIO_QA_GERAL_REMOTE_BUILD:-}" != 1 ]] || {
    echo "Consentimento V3 exige qaGeral local" >&2; exit 2
  }
  if [[ "${ATRIO_QA_PROFILE_V3_TALKBACK_SPEECH:-}" == 1 ]]; then
    adb root
    adb wait-for-device
    [[ "$(adb shell id -u)" == 0 ]] || { echo "O AVD de QA recusou a configuração diagnóstica do TalkBack"; exit 2; }
    # Restarting adbd removes the port mappings set during Firebase QA startup.
    adb reverse tcp:9099 tcp:9099
    adb reverse tcp:8089 tcp:8089
    adb reverse --list
    talkback_package=com.google.android.marvin.talkback
    adb shell pm path "$talkback_package"
    adb shell am force-stop "$talkback_package"
    adb shell pm grant "$talkback_package" android.permission.POST_NOTIFICATIONS
    adb shell setprop log.tag.talkback VERBOSE
    adb shell setprop log.tag.SpeechControllerImpl VERBOSE
    adb shell setprop log.tag.FailoverTextToSpeech VERBOSE
    prefs_xml="$(mktemp)"
    for storage in /data/user_de/0 /data/user/0; do
      prefs_root="$storage/$talkback_package"
      prefs="$prefs_root/shared_prefs/$talkback_package""_preferences.xml"
      adb shell "test -d '$prefs_root'"
      adb shell "if test -f '$prefs'; then cat '$prefs'; fi" > "$prefs_xml"
      python3 - "$prefs_xml" <<'PY'
import os
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot() if os.path.getsize(path) else ET.Element("map")
for entry in list(root):
    if entry.get("name") in {"pref_log_level", "pref_tts_overlay", "pref_diagnosis_mode"}:
        root.remove(entry)
ET.SubElement(root, "string", name="pref_log_level").text = "2"
ET.SubElement(root, "boolean", name="pref_tts_overlay", value="true")
ET.SubElement(root, "boolean", name="pref_diagnosis_mode", value="true")
ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
PY
      adb push "$prefs_xml" /data/local/tmp/atrio-talkback-prefs.xml
      app_owner="$(adb shell stat -c '%u:%g' "$prefs_root")"
      adb shell "mkdir -p '$prefs_root/shared_prefs' && cp /data/local/tmp/atrio-talkback-prefs.xml '$prefs' &&
        chown '$app_owner' '$prefs_root/shared_prefs' '$prefs' &&
        chmod 770 '$prefs_root/shared_prefs' && chmod 660 '$prefs' &&
        restorecon -RF '$prefs_root/shared_prefs'"
    done
    rm -f "$prefs_xml"
    adb shell rm -f /data/local/tmp/atrio-talkback-prefs.xml
    adb logcat -G 16M
    run_suite "$ATRIO_QA_SUITE" -Pandroid.testInstrumentationRunnerArguments.atrioVerifyTalkBackSpeech=true
    adb logcat -d -v threadtime | awk '/SpeechControllerImpl:|GoogleTTSServiceImpl: TTS dispatch|a11y_unified_save/' \
      > qa-android-suite-results/talkback-speech.log
  else
    run_suite "$ATRIO_QA_SUITE"
  fi
  adb logcat -d -s AtrioQaProfileV3:I '*:S' \
    > qa-android-suite-results/profile-v3-offline.log
  if [[ "${ATRIO_QA_PROFILE_V3_DISCUSSIONS_HTTP:-}" == 1 ]]; then
    profile_tls_dir="$(mktemp -d)"
    (umask 077; openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
      -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
      -keyout "$profile_tls_dir/key.pem" -out "$profile_tls_dir/cert.pem" 2>/dev/null)
    worker_log="qa-android-suite-results/profile-v3-worker.log"
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 \
      node tests/security/serve-profile-v3-discussion-android-qa.mjs \
        "$profile_tls_dir/key.pem" "$profile_tls_dir/cert.pem" > "$worker_log" 2>&1 &
    profile_worker_pid=$!
    ready=0
    for attempt in $(seq 1 45); do
      if ! kill -0 "$profile_worker_pid" 2>/dev/null; then break; fi
      if curl --noproxy '*' --cacert "$profile_tls_dir/cert.pem" \
        -fsS --max-time 1 https://127.0.0.1:8094/health >/dev/null; then
        ready=1
        break
      fi
      sleep 1
    done
    if [[ "$ready" != 1 ]]; then
      tail -30 "$worker_log" >&2
      exit 1
    fi
    adb reverse tcp:8094 tcp:8094
    worker_cert="$(openssl x509 -in "$profile_tls_dir/cert.pem" -outform DER | base64 -w0)"
    run_suite ProfileV3DiscussionHttpEmulatorUiTest \
      "-Pandroid.testInstrumentationRunnerArguments.profileV3WorkerCert=$worker_cert"
    # A confirmação negativa exige 403 das Rules, não indisponibilidade do transporte.
    cat "$worker_log"
    authorized_reads="$(grep -c '^visitor=authorized firestore=200 result=available exact_id=qa-v3-http-z-escolhida$' "$worker_log" || true)"
    if [[ "$authorized_reads" -lt 2 ]] ||
      ! grep -qx 'visitor=denied firestore=403 result=unavailable without_metadata' "$worker_log" ||
      grep -qE '^Unexpected|failed' "$worker_log"; then
      echo "O Worker não comprovou autorização inicial, revalidação no toque e recusa sem metadados." >&2
      qa_failed=1
    fi
  fi
  exit "$qa_failed"
fi
if [[ "$inbox_focal" == 1 ]]; then
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    node tests/security/serve-inbox-discovery-android-qa.mjs > qa-inbox-discovery-emulator.log 2>&1 &
  inbox_pid=$!
  ready=0
  for attempt in $(seq 1 60); do
    if ! kill -0 "$inbox_pid" 2>/dev/null; then break; fi
    if curl -s --max-time 1 -o /dev/null http://127.0.0.1:8091/; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "Fixture local da inbox não abriu a porta 8091" >&2
    tail -60 qa-inbox-discovery-emulator.log >&2
    exit 1
  fi
  adb reverse tcp:8091 tcp:8091
  run_suite "$ATRIO_QA_SUITE"
  if [[ "$qa_failed" == 0 ]]; then
    grep -F 'Inbox QA local: HTTP 409 na continuação.' qa-inbox-discovery-emulator.log
    authenticated_block_suite=AtrioAuthenticatedBlockEmulatorUiTest
    run_suite "$authenticated_block_suite"
    if [[ "$qa_failed" == 0 ]]; then
      grep -F 'QA BLOCK 503: sem bloqueio ou recibo' qa-inbox-discovery-emulator.log
      grep -F 'QA BLOCK 200: mesma chave e ETag' qa-inbox-discovery-emulator.log
      grep -F 'QA BLOCK 200: mutação e recibo gravados; projeções coerentes.' qa-inbox-discovery-emulator.log
    fi
    managed_block_suite=AtrioManagedBlockUiTest
    run_suite "$managed_block_suite"
  fi
  if [[ "$qa_failed" == 0 ]]; then
    authenticated_message_suite=AtrioInboxMessageEmulatorUiTest
    run_suite "$authenticated_message_suite"
    if [[ "$qa_failed" == 0 ]]; then
      test "$(grep -Fc 'QA MESSAGE 400: limite UTF-16 recusado' qa-inbox-discovery-emulator.log)" -eq 4
      grep -F 'QA MESSAGE 503: sem conversa, quota ou recibo' qa-inbox-discovery-emulator.log
      grep -F 'QA MESSAGE 200: primeiro contato confirmou' qa-inbox-discovery-emulator.log
      grep -F 'QA MESSAGE 200: retry pós-timeout preservou' qa-inbox-discovery-emulator.log
    fi
  fi
  exit "$qa_failed"
fi
if [[ "${ATRIO_QA_GERAL_CELULAR_PILOT:-}" == 1 ]]; then
  (cd tests/security && node seed-qa-celular-pilot-android.mjs)
  run_suite "$ATRIO_QA_SUITE"
  exit "$qa_failed"
fi
if [[ "${ATRIO_QA_SUITE:-}" == AtrioConversasCompostasEmulatorUiTest ]]; then
  [[ "$qa_apk" == qaGeral && "${ATRIO_QA_GERAL_REMOTE_BUILD:-}" != 1 &&
     "${ATRIO_QA_INBOX_DISCOVERY:-}" != 1 ]] || {
    echo "Histórico regular exige qaGeral local sem descoberta opt-in" >&2
    exit 2
  }
  node firebase/qa-general/compose-parity-rules.mjs
  (cd tests/security && node seed-chat-groups-android.mjs)
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
run_suite AtrioConversasTrocaContaEmulatorUiTest
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
