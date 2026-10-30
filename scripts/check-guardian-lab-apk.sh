#!/usr/bin/env bash
# Verify the actual compiled APK; do not trust the source manifest alone.
set -euo pipefail
apk="$1"
test -s "$apk" || { echo "LAB_APK_MISSING"; exit 1; }
aapt="$ANDROID_HOME/build-tools/35.0.0/aapt"
test -x "$aapt" || { echo "AAPT_NOT_FOUND"; exit 1; }
"$aapt" dump badging "$apk" | grep -Fq "package: name='br.com.atriocatolico.guardianlab'"
permissions=$("$aapt" dump permissions "$apk")
if printf '%s\n' "$permissions" | grep -E '(INTERNET|POST_NOTIFICATIONS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|ACCESS_NETWORK_STATE)'; then
    echo "LAB_NETWORK_OR_STORAGE_PERMISSION_FORBIDDEN"
    exit 1
fi
echo "GUARDIAN_LAB_APK_OFFLINE_PASS: distinct package, no network/notification/storage permission"
