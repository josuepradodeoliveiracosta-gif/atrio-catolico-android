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

    SERVER_PID=""
    cleanup() {
      if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" 2>/dev/null || :
        wait "$SERVER_PID" 2>/dev/null || :
        SERVER_PID=""
      fi
    }
    trap cleanup EXIT
    adb install --no-streaming "$INSTRUMENTATION"

    run_ui_test() {
      local test_method="$1" fixture_mode="$2"
      if [[ "$fixture_mode" == "offline" ]]; then
        # A recusa de conexao deve ser detectada sem nenhuma oferta de APK.
        if curl --noproxy '*' -fsS --max-time 3 \
          http://127.0.0.1:8765/releases/latest >/dev/null 2>&1; then
          echo "::error::Cenario offline invalido: servidor ainda esta acessivel" >&2
          exit 1
        fi
      else
        python3 scripts/ota_qa_loopback_server.py \
          --apk "$NEW" --manifest "$OUT/update.json" --mode "$fixture_mode" \
          > "$OUT/server-$fixture_mode.log" 2>&1 &
        SERVER_PID=$!
        local ready=false
        local probe_url="http://127.0.0.1:8765/releases/latest"
        if [[ "$fixture_mode" == "api-unavailable-once" ]]; then
          # Nao consumir o primeiro 503 da API na sondagem do runner:
          # verificar o endpoint imutavel do manifesto, preservando a falha
          # exclusivamente para a primeira consulta feita pela Activity.
          local fixture_tag
          fixture_tag="$(python3 -c 'import json,sys;print("v"+json.load(open(sys.argv[1]))["versionName"])' "$OUT/update.json")"
          probe_url="http://127.0.0.1:8765/releases/download/$fixture_tag/update.json"
        fi
        for attempt in $(seq 1 35); do
          if curl --noproxy '*' -fsS "$probe_url" \
            > "$OUT/release-$fixture_mode.json"; then
            ready=true
            break
          fi
          sleep 1
        done
        [[ "$ready" == "true" ]] || {
          echo "::error::Servidor OTA local nao iniciou: $fixture_mode" >&2
          cat "$OUT/server-$fixture_mode.log"
          exit 1
        }
      fi

      # Cada chamada abre a interface OTA em estado limpo, sem Firebase real.
      # O prefixo do teste limita qual cenário será executado nesse servidor.
      adb shell am force-stop "$PACKAGE" || :
      local result="$OUT/ota-in-app-$fixture_mode.txt"
      adb shell am instrument -w -r \
        -e class "br.com.atriocatolico.OtaQaLoopbackUiTest#$test_method" \
        "$PACKAGE.test/br.com.atriocatolico.QaAndroidTestRunner" | tee "$result"
      grep -q 'OK (1 test)' "$result" || {
        echo "::error::Teste OTA do app falhou: $fixture_mode / $test_method" >&2
        exit 1
      }
      cleanup
    }

    # O teste positivo faz o download autenticado pelo contrato OTA, valida
    # tamanho, SHA-256, versão, assinatura e oferece botão Instalar.
    # A UI também grava um marcador de dados que deve persistir após upgrade.
    run_ui_test discoversAndVerifiesDownloadInApp valid

    # Simula encerramento abrupto apos download valido: o APK final ainda
    # pode estar sob leitura do instalador, mas .part nao pode persistir.
    adb shell run-as "$PACKAGE" ls cache/ota/atrio-catolico-ota.apk >/dev/null
    adb shell run-as "$PACKAGE" touch cache/ota/atrio-catolico-ota.part.apk
    adb shell run-as "$PACKAGE" touch cache/ota/qa-other-cache.txt
    run_ui_test clearsOrphanedPartialOnAppStartWithoutDeletingInstallerApk valid
    if adb shell run-as "$PACKAGE" ls cache/ota/atrio-catolico-ota.part.apk >/dev/null 2>&1; then
      echo "::error::Arquivo OTA parcial orfao nao foi removido no inicio" >&2
      exit 1
    fi
    adb shell run-as "$PACKAGE" ls cache/ota/atrio-catolico-ota.apk >/dev/null
    adb shell run-as "$PACKAGE" ls cache/ota/qa-other-cache.txt >/dev/null
    # Terminou a simulacao; nao propagar arquivos aos casos negativos seguintes.
    adb shell run-as "$PACKAGE" rm -f cache/ota/atrio-catolico-ota.apk cache/ota/qa-other-cache.txt

    # Testes negativos na própria interface, com os mesmos componentes usados
    # no release (sem permitir baixar/install APK que viole a política).
    run_ui_test rejectsWrongCertificateBeforeDownload bad-cert

    # Redirect para host externo no manifesto: nao oferecer o APK.
    run_ui_test blocksExternalRedirectForManifestBeforeOfferingDownload manifest-redirect-external
    if ! grep -Eq 'GET /releases/download/[^ ]+/update[.]json HTTP/1[.]1" 302 ' \
      "$OUT/server-manifest-redirect-external.log"; then
      echo "::error::Fixture de redirect externo do manifesto nao foi usado" >&2
      exit 1
    fi
    if grep -Eq 'GET /releases/download/[^ ]+/atrio-catolico[.]apk ' \
      "$OUT/server-manifest-redirect-external.log"; then
      echo "::error::APK foi requisitado apos manifesto redirecionado" >&2
      exit 1
    fi

    # Redirect para host externo no APK: nenhuma instalacao nem cache residual.
    run_ui_test blocksExternalRedirectForApkWithoutKeepingPartialFile apk-redirect-external
    if ! grep -Eq 'GET /releases/download/[^ ]+/atrio-catolico[.]apk HTTP/1[.]1" 302 ' \
      "$OUT/server-apk-redirect-external.log"; then
      echo "::error::Fixture de redirect externo do APK nao foi usado" >&2
      exit 1
    fi
    # O manifest/arquivo podem redirecionar infinitamente para si mesmos;
    # o cliente deve limitar a seis requisicoes (indices 0..5), recusar
    # a operacao e limpar caches sem permitir instalacao.
    run_ui_test refusesCircularRedirectForManifestWithinBoundedRequests manifest-redirect-loop
    manifest_loops=$(grep -Ec 'GET /releases/download/[^ ]+/update[.]json HTTP/1[.]1" 302 ' \
      "$OUT/server-manifest-redirect-loop.log" || :)
    [[ "$manifest_loops" == "6" ]] || {
      echo "::error::Manifesto em loop teve $manifest_loops redirects, esperados 6" >&2
      exit 1
    }
    if grep -Eq 'GET /releases/download/[^ ]+/atrio-catolico[.]apk ' \
      "$OUT/server-manifest-redirect-loop.log"; then
      echo "::error::APK requisitado depois do loop do manifesto" >&2
      exit 1
    fi

    run_ui_test refusesCircularRedirectForApkWithoutCacheOrInstallation apk-redirect-loop
    apk_loops=$(grep -Ec 'GET /releases/download/[^ ]+/atrio-catolico[.]apk HTTP/1[.]1" 302 ' \
      "$OUT/server-apk-redirect-loop.log" || :)
    [[ "$apk_loops" == "6" ]] || {
      echo "::error::APK em loop teve $apk_loops redirects, esperados 6" >&2
      exit 1
    }

    run_ui_test rejectsWrongApkChecksumAfterDownloading bad-hash
    run_ui_test rejectsDowngradeWithoutOfferingDownload downgrade
    run_ui_test handlesOfflineServerWithoutOfferingInstallation offline
    run_ui_test recoversFromUnavailableServerAfterManualRefresh api-unavailable-once
    # O fixture deve ter fornecido exatamente uma falha HTTP, seguida de
    # sucesso. O probe do runner consulta apenas update.json.
    if [[ "$(grep -Ec 'GET /releases/latest HTTP/1[.]1" 503 ' "$OUT/server-api-unavailable-once.log")" -ne 1 ]]; then
      echo "::error::API QA nao registrou uma unica consulta HTTP 503" >&2
      exit 1
    fi
    if ! grep -Eq 'GET /releases/latest HTTP/1[.]1" 200 ' "$OUT/server-api-unavailable-once.log"; then
      echo "::error::API QA nao registrou consulta recuperada HTTP 200" >&2
      exit 1
    fi
    run_ui_test rejectsInterruptedDownloadWithoutOfferingInstallation truncated-apk
    run_ui_test retriesInterruptedDownloadAndVerifiesSameOffer truncated-once
    run_ui_test cancelsSlowDownloadWithoutOfferingInstallation slow-apk
    run_ui_test refusesDownloadWhenStorageIsInsufficient valid
    # Este ultimo servidor 'valid' atende somente o teste sem espaco.
    # O manifesto pode ser consultado, mas o APK nao deve ser requisitado.
    if grep -Eq 'GET /releases/download/[^ ]+/atrio-catolico[.]apk ' \
      "$OUT/server-valid.log"; then
      echo "::error::APK foi requisitado apesar de espaco insuficiente" >&2
      exit 1
    fi
    if adb shell run-as "$PACKAGE" cat shared_prefs/atrio_ota_lab_prefs.xml \
      | grep -q 'qa_force_low_space'; then
      echo "::error::Preferencia de simulacao de espaco nao foi removida" >&2
      exit 1
    fi
    # Nem o download temporario nem um APK pronto podem sobreviver a
    # interrupcao remota OU ao cancelamento iniciado pelo usuario.
    for filename in atrio-catolico-ota.part.apk atrio-catolico-ota.apk; do
      if adb shell run-as "$PACKAGE" ls "cache/ota/$filename" >/dev/null 2>&1; then
        echo "::error::Arquivo OTA residual apos falha: $filename" >&2
        exit 1
      fi
    done

    # APK correto no primeiro download, mas adulterado por byte antes
    # do toque Instalar: a UI deve revalidar e descartar os dois caches.
    run_ui_test rejectsTamperedDownloadedApkBeforeInstall valid
    for filename in atrio-catolico-ota.part.apk atrio-catolico-ota.apk; do
      if adb shell run-as "$PACKAGE" ls "cache/ota/$filename" >/dev/null 2>&1; then
        echo "::error::APK adulterado continuou no cache apos rejeicao: $filename" >&2
        exit 1
      fi
    done

    # Apenas depois dos testes de bloqueio, atualizar por ADB.
    # Não se trata de consentimento do instalador Android; esse teste foi
    # comprovado separadamente em aparelho físico pelo operador.
    adb install -r --no-streaming "$NEW"
    adb shell run-as "$PACKAGE" ls files/ota-lab-preserved >/dev/null
    adb shell run-as "$PACKAGE" cat \
      shared_prefs/atrio_ota_lab_prefs.xml | grep -Eq \
      'name="qa_marker_preserved" value="true"' || {
      echo "::error::Dados gravados no app nao foram preservados pelo upgrade" >&2
      exit 1
    }
    installed=$(adb shell dumpsys package "$PACKAGE" | grep -m 1 'versionCode=' || :)
    echo "$installed" | grep -Eq 'versionCode=35([[:space:]]|$)' || {
      echo "::error::Android nao confirmou QA versionCode=35" >&2
      exit 1
    }
    echo "PASSOU: OTA no app, rejeicao de hash/certificado/downgrade/offline/truncado/cancelado/sem-espaco/adulteracao-pos-download e retentativa segura, cache parcial limpo no reinicio, consulta 503 recuperada, redirects externos/circulares bloqueados e dados da UI preservados em code 34 -> 35."
    ;;
  *)
    echo "Uso: bash scripts/ota_qa_in_app.sh prepare|emulator" >&2
    exit 2
    ;;
esac
