#!/usr/bin/env bash
set -euo pipefail

out=qa-notice-states
package=br.com.atriocatolico.qageral.celular
permission=android.permission.POST_NOTIFICATIONS
activity="$package/br.com.atriocatolico.MainActivity"
apk=app/build/outputs/apk/qaGeral/app-qaGeral.apk
first=emulator-5554
second=emulator-5556

printf 'no\n' | avdmanager create avd --name notice_states_second \
    --package 'system-images;android-35;google_apis;x86_64' --device pixel_4
"$ANDROID_HOME/emulator/emulator" @notice_states_second -port 5556 -cores 2 -memory 2048 \
    -no-snapshot -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim \
    -accel on -camera-back none > "$out/second-emulator.log" 2>&1 &
second_pid=$!
trap 'kill "$second_pid" 2>/dev/null || true' EXIT

booted() {
    [[ "$(adb -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]
}
for attempt in $(seq 1 90); do
    if booted "$first" && booted "$second"; then break; fi
    kill -0 "$second_pid"
    sleep 2
done
booted "$first"
booted "$second"
adb devices -l | tee "$out/devices.txt"
result=0

for serial in "$first" "$second"; do
    mkdir -p "$out/$serial"
    evidence="$out/$serial"
    device() { adb -s "$serial" "$@"; }
    capture() { device exec-out screencap -p > "$evidence/$1.png"; }

    device shell getprop ro.build.version.sdk | tr -d '\r' | tee "$evidence/api.txt"
    grep -qx '35' "$evidence/api.txt"
    device shell pm list packages -e com.google.android.gms | tr -d '\r' | grep -x 'package:com.google.android.gms'
    device shell dumpsys package com.google.android.gms | grep 'versionName=' > "$evidence/play-services.txt"
    device shell cmd connectivity airplane-mode enable
    device shell svc wifi disable
    device shell svc data disable
    device shell settings get global airplane_mode_on | tr -d '\r' | tee "$evidence/airplane-mode.txt"
    grep -qx '1' "$evidence/airplane-mode.txt"

    # Fresh Google APIs AVDs can intercept the Home key during provisioning.
    device shell settings put global device_provisioned 1
    device shell settings put secure user_setup_complete 1
    device shell settings put secure immersive_mode_confirmations confirmed
    device shell input keyevent KEYCODE_WAKEUP
    device shell wm dismiss-keyguard
    device shell settings put global window_animation_scale 0
    device shell settings put global transition_animation_scale 0
    device shell settings put global animator_duration_scale 0
    device shell wm size 720x1520
    device shell wm density 320
    device install "$apk"

    device shell pm grant "$package" "$permission"
    device shell dumpsys package "$package" | grep "$permission: granted=true" > "$evidence/permission-allowed.txt"
    device shell am start -W -n "$activity" | tee "$evidence/launch.txt"
    device shell dumpsys activity activities | grep -F 'topResumedActivity' > "$evidence/foreground.txt"
    grep -F "$package/" "$evidence/foreground.txt"
    device shell am start -W -a android.intent.action.MAIN -c android.intent.category.HOME \
        | tee "$evidence/home-launch.txt"
    for attempt in $(seq 1 10); do
        device shell dumpsys activity activities > "$evidence/background.txt"
        if grep -F 'topResumedActivity' "$evidence/background.txt" | grep -Ev "$package/|null"; then break; fi
        sleep 2
    done
    grep -F 'topResumedActivity' "$evidence/background.txt" | grep -Ev "$package/|null"
    device shell dumpsys activity recents > "$evidence/background-recents.txt"
    grep 'Recent #' "$evidence/background-recents.txt" | grep -F "$package"
    printf '%s background=PASS\n' "$serial"

    device shell input keyevent KEYCODE_APP_SWITCH
    sleep 2
    capture recents-before
    for attempt in $(seq 1 5); do
        device shell input swipe 360 730 360 100 320
        sleep 3
        device shell dumpsys activity recents > "$evidence/recents-after.txt"
        if ! grep 'Recent #' "$evidence/recents-after.txt" | grep -Fq "$package"; then break; fi
        # If first-run help or a busy launcher intercepted the swipe, dismiss
        # its dialog by text before retrying the removal on the same card.
        device shell uiautomator dump /data/local/tmp/qa-notice-recent.xml >/dev/null || continue
        device exec-out cat /data/local/tmp/qa-notice-recent.xml > "$evidence/recents-ui.xml"
        position="$(python3 - "$evidence/recents-ui.xml" <<'PYUI'
import re
import sys
import xml.etree.ElementTree as ET

for node in ET.parse(sys.argv[1]).iter("node"):
    if node.get("text") in {"Wait", "Got it"}:
        left, top, right, bottom = map(int, re.findall(r"\d+", node.attrib["bounds"]))
        print((left + right) // 2, (top + bottom) // 2)
        break
PYUI
)"
        if [[ -n "$position" ]]; then
            read -r x y <<< "$position"
            device shell input tap "$x" "$y"
            sleep 2
        fi
    done
    capture recents-after
    if grep 'Recent #' "$evidence/recents-after.txt" | grep -Fq "$package"; then
        printf '%s removed-from-recents=FAIL\n' "$serial"
        result=1
    else
        device shell dumpsys package "$package" | grep -F 'stopped=false' > "$evidence/package-not-stopped.txt"
        printf '%s removed-from-recents=PASS\n' "$serial"
    fi

    device shell pm revoke "$package" "$permission"
    device shell dumpsys package "$package" | grep "$permission: granted=false" > "$evidence/permission-denied.txt"
    printf '%s post-notifications-denied=PASS\n' "$serial"
    device shell pm grant "$package" "$permission"
    device shell dumpsys package "$package" | grep "$permission: granted=true" > "$evidence/permission-restored.txt"

    device shell am start -W -n "$activity" > "$evidence/launch-before-lock.txt"
    device shell locksettings set-pin 2580 > /dev/null
    device shell settings put secure lock_screen_lock_after_timeout 0
    device shell input keyevent KEYCODE_SLEEP
    sleep 2
    device shell input keyevent KEYCODE_WAKEUP
    sleep 2
    capture lockscreen
    device shell dumpsys window policy > "$evidence/lockscreen-policy.txt"
    if grep -E '^[[:space:]]+showing=true' "$evidence/lockscreen-policy.txt" &&
        grep -E '^[[:space:]]+secure=true' "$evidence/lockscreen-policy.txt"; then
        printf '%s lockscreen=PASS\n' "$serial"
    else
        printf '%s lockscreen=FAIL\n' "$serial"
        result=1
    fi
done
exit "$result"
