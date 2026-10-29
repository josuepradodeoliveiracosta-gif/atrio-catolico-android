#!/usr/bin/env bash
set -euo pipefail
test "${QA_MODE:-}" = session
test "${GITHUB_EVENT_NAME:-}" = workflow_dispatch
test "${GITHUB_RUN_ATTEMPT:-}" = 1
test -f "${VERIFIED_APK:?APK nao validado}"
# No rebuild, re-signing, instrumentation APK or Firebase emulator.
adb install -g "$VERIFIED_APK"
python3 scripts/qa_official/run.py
