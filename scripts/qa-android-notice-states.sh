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
    device shell input swipe 360 730 360 100 320
    sleep 2
    capture recents-after
    device shell dumpsys activity recents > "$evidence/recents-after.txt"
    if grep 'Recent #' "$evidence/recents-after.txt" | grep -Fq "$package"; then exit 1; fi
    device shell dumpsys package "$package" | grep -F 'stopped=false' > "$evidence/package-not-stopped.txt"
    printf '%s removed-from-recents=PASS\n' "$serial"

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
    grep -E '^[[:space:]]+showing=true' "$evidence/lockscreen-policy.txt"
    grep -E '^[[:space:]]+secure=true' "$evidence/lockscreen-policy.txt"
    printf '%s lockscreen=PASS\n' "$serial"
done
