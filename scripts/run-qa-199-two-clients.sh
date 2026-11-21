#!/usr/bin/env bash
# Runs inside the qaGeral Actions emulator workflow after Firebase fixtures.
set -euo pipefail
first=emulator-5554
second=emulator-5556
release=/data/local/tmp/atrio-199-both-open
results=qa-android-suite-results/two-clients
package=br.com.atriocatolico.qageral
emulator_binary="${ANDROID_HOME:?Android SDK não configurado}/emulator/emulator"
mkdir -p "$results"
test -x "$emulator_binary"

cleanup_second() {
  adb -s "$second" emu kill >/dev/null 2>&1 || true
  kill "$second_pid" 2>/dev/null || true
}
adb -s "$first" shell true
printf 'no\n' | avdmanager create avd --force --name atrio_qa_199_second \
  --package 'system-images;android-35;google_apis;x86_64' --device pixel_4
"$emulator_binary" @atrio_qa_199_second -port 5556 -no-window -no-snapshot -noaudio -no-boot-anim \
  -gpu swiftshader_indirect -accel on -memory 2048 -camera-back none \
  > "$results/second-emulator.txt" 2>&1 &
second_pid=$!
trap cleanup_second EXIT
kill -0 "$second_pid"
gradle :app:assembleQaGeral :app:assembleQaGeralAndroidTest --daemon --stacktrace

timeout 180 adb -s "$second" wait-for-device
for ((attempt=0; attempt<90; attempt++)); do
  if [[ "$(adb -s "$second" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then break; fi
  kill -0 "$second_pid"
  sleep 2
done
test "$(adb -s "$second" shell getprop sys.boot_completed | tr -d '\r')" = 1
adb devices -l
adb -s "$second" reverse tcp:9099 tcp:9099
adb -s "$second" reverse tcp:8089 tcp:8089
test_apk="$(find app/build/outputs/apk/androidTest/qaGeral -name '*.apk' -print -quit)"
test -n "$test_apk"

run_client() {
  local serial="$1" role="$2" runner
  adb -s "$serial" shell rm -f "$release"
  for key in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb -s "$serial" shell settings put global "$key" 0
  done
  adb -s "$serial" install -r app/build/outputs/apk/qaGeral/app-qaGeral.apk
  adb -s "$serial" install -r -t "$test_apk"
  runner="$(adb -s "$serial" shell pm list instrumentation "$package" |
    awk '/QaAndroidTestRunner/ {sub(/^instrumentation:/, "", $1); print $1}')"
  test -n "$runner"
  adb -s "$serial" logcat -c
  adb -s "$serial" shell am instrument -w -r \
    -e class 'br.com.atriocatolico.Atrio199ClientesEmulatorUiTest#doisClientesLeemEnviamEReabrem' \
    -e atrioQaClientRole "$role" "$runner" > "$results/instrument-$role.txt" 2>&1
  grep -F 'OK (1 test)' "$results/instrument-$role.txt"
}

run_client "$first" ALICE &
alice_pid=$!
run_client "$second" LUCIA &
lucia_pid=$!
for ((attempt=0; attempt<120; attempt++)); do
  if adb -s "$first" logcat -d -s Atrio199QA:I | grep -F 'papel=ALICE cliente_aberto=true' >/dev/null &&
     adb -s "$second" logcat -d -s Atrio199QA:I | grep -F 'papel=LUCIA cliente_aberto=true' >/dev/null; then
    for serial in "$first" "$second"; do
      adb -s "$serial" shell "printf ready > $release"
      test "$(adb -s "$serial" shell cat "$release")" = ready
    done
    echo "Barreira #199 liberada com duas threads visíveis antes do envio"
    break
  fi
  if ! kill -0 "$alice_pid" || ! kill -0 "$lucia_pid"; then break; fi
  sleep 1
done
failed=0
wait "$alice_pid" || failed=1
wait "$lucia_pid" || failed=1
adb -s "$first" logcat -d > "$results/logcat-ALICE.txt"
adb -s "$second" logcat -d > "$results/logcat-LUCIA.txt"
grep -h 'Atrio199QA:' "$results"/logcat-*.txt || true
if [[ "$failed" != 0 ]]; then
  tail -n 40 "$results"/instrument-*.txt
  exit 1
fi
alice_ids="$(grep -Eo 'id_alice=[[:alnum:]]+ id_lucia=[[:alnum:]]+' "$results/logcat-ALICE.txt")"
lucia_ids="$(grep -Eo 'id_alice=[[:alnum:]]+ id_lucia=[[:alnum:]]+' "$results/logcat-LUCIA.txt")"
test -n "$alice_ids"
test "$alice_ids" = "$lucia_ids"
