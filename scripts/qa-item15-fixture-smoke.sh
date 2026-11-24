#!/usr/bin/env bash
# Smoke exclusivo do Auth/Firestore Emulator. Não usa FCM nem Firebase remotos.
set -euo pipefail
cd "$(dirname "$0")/../tests/security"
test "${FIRESTORE_EMULATOR_HOST:-}" = '127.0.0.1:8089'
test "${FIREBASE_AUTH_EMULATOR_HOST:-}" = '127.0.0.1:9099'
test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}"
node seed-qa-conversation-notice-android.mjs
node serve-qa-conversation-notice-android.mjs > ../../qa-item15-fixture-smoke.log 2>&1 &
server=$!
cleanup() { kill "$server" 2>/dev/null || true; }
trap cleanup EXIT
ready=0
for i in $(seq 1 30); do
  if curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:8092/ready >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$server" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo 'Fixture item 15 não iniciou.' >&2
  tail -20 ../../qa-item15-fixture-smoke.log >&2
  exit 1
fi
for action in revoke restore new-notice revoke-restoration; do
  code="$(curl --noproxy '*' -sS --max-time 12 -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:8092/test/age18/$action")"
  printf 'Fixture item 15: %s HTTP %s\n' "$action" "$code"
  if [[ "$code" != 204 ]]; then
    grep -F 'QA idade 18+ fixture:' ../../qa-item15-fixture-smoke.log | tail -12 >&2 || true
    exit 1
  fi
done
# Reconstitui apenas o Firestore Emulator e ensaia também Miguel → Clara.
node seed-qa-conversation-notice-android.mjs --firestore-only
for action in reverse-setup revoke restore new-notice revoke-restoration; do
  code="$(curl --noproxy '*' -sS --max-time 12 -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:8092/test/age18/$action")"
  printf 'Fixture inversa item 15: %s HTTP %s\n' "$action" "$code"
  if [[ "$code" != 204 ]]; then
    grep -F 'QA idade 18+ fixture:' ../../qa-item15-fixture-smoke.log | tail -12 >&2 || true
    exit 1
  fi
done
echo 'Fixture local item 15 aprovada A→B e B→A sem FCM remoto.'
