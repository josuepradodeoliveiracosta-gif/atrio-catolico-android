#!/usr/bin/env bash
# Apenas GitHub Actions, AVD efêmero e Firebase Emulator local.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "${GITHUB_ACTIONS:-}" == true && "${ATRIO_ITEM13_HTTPS_QA:-}" == 1 &&
   "${ATRIO_QA_GERAL_BUILD:-}" == 1 && "${ATRIO_QA_GERAL_CELULAR_PILOT:-}" == 1 &&
   "${ATRIO_QA_APK:-}" == qaGeral && "${ATRIO_QA_FIREBASE_PROJECT:-}" == demo-atrio-v11 &&
   "${ATRIO_QA_MODERATION_CASE_LAB:-}" == 1 &&
   "${ATRIO_QA_MODERATION_CASE_ORIGIN:-}" == https://127.0.0.1:8095 &&
   "${ATRIO_QA_GERAL_REMOTE_BUILD:-}" != 1 && "${ATRIO_QA_GERAL_PUSH_BUILD:-}" != 1 &&
   -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -z "${ATRIO_PUSH_WORKER_URL:-}" ]]
tls="${RUNNER_TEMP:?}/item13-https-tls"
out="$PWD/qa-item13-https-evidence"
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8089
export GCLOUD_PROJECT=demo-atrio-v11 GOOGLE_CLOUD_PROJECT=demo-atrio-v11
case "${1:-}" in
prepare)
  mkdir -p "$out"
  git rev-parse HEAD HEAD^{tree} > "$out/identity.txt"
  umask 077
  mkdir "$tls"
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=Item13 ephemeral QA CA' \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$tls/ca.key" -out "$tls/ca.pem" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj '/CN=127.0.0.1' \
    -keyout "$tls/server.key" -out "$tls/server.csr" >/dev/null 2>&1
  printf '%s\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' \
    'extendedKeyUsage=serverAuth' 'subjectAltName=IP:127.0.0.1' > "$tls/good.ext"
  openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.pem" -CAkey "$tls/ca.key" \
    -CAcreateserial -days 1 -sha256 -extfile "$tls/good.ext" -out "$tls/good.pem" >/dev/null 2>&1
  sed 's/subjectAltName=IP:127.0.0.1/subjectAltName=DNS:wrong.qa.invalid/' "$tls/good.ext" > "$tls/wrong.ext"
  openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.pem" -CAkey "$tls/ca.key" \
    -CAserial "$tls/ca.srl" -days 1 -sha256 -extfile "$tls/wrong.ext" -out "$tls/wrong.pem" >/dev/null 2>&1
  openssl req -x509 -new -key "$tls/server.key" -days 1 -subj '/CN=Untrusted QA certificate' \
    -addext 'subjectAltName=IP:127.0.0.1' -out "$tls/untrusted.pem" >/dev/null 2>&1
  openssl verify -CAfile "$tls/ca.pem" -verify_ip 127.0.0.1 "$tls/good.pem"
  if openssl verify -CAfile "$tls/ca.pem" -verify_ip 127.0.0.1 "$tls/wrong.pem" >/dev/null 2>&1; then exit 1; fi
  if openssl verify -CAfile "$tls/ca.pem" -verify_ip 127.0.0.1 "$tls/untrusted.pem" >/dev/null 2>&1; then exit 1; fi
  # Não altera código versionado. Recurso QA local apenas neste checkout efêmero.
  raw=app/src/qaEmulator/res/raw
  mkdir -p "$raw"
  cp "$tls/ca.pem" "$raw/item13_lab_ca.pem"
  cfg=app/src/qaEmulator/res/xml/qa_emulator_network_security.xml
  python3 - "$cfg" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
needle='<domain includeSubdomains="false">127.0.0.1</domain>'
assert s.count(needle)==1 and 'trust-anchors' not in s
s=s.replace(needle,needle+"""
        <trust-anchors>
            <certificates src="@raw/item13_lab_ca" />
        </trust-anchors>
    </domain-config>
    <domain-config cleartextTrafficPermitted="true">""")
p.write_text(s)
PY
  sha256sum "$cfg" "$raw/item13_lab_ca.pem" >> "$out/identity.txt"
  for config in app/src/qaGeral/google-services.json app/src/chatQa/google-services.json app/src/perfilQa/google-services.json; do
    test ! -e "$config"
  done
  rm -f -- app/google-services.json
  bash scripts/qa-android-prebuild.sh start
  ;;
run)
  test -r "$tls/good.pem"
  firebase_pid= server_pid=
  cleanup() {
    if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
    if [[ -n "$firebase_pid" ]]; then kill "$firebase_pid" 2>/dev/null || true; fi
    for port in 8095 9099 8089; do adb reverse --remove "tcp:$port" >/dev/null 2>&1 || true; done
  }
  trap cleanup EXIT
  node firebase/qa-general/compose-parity-rules.mjs
  cp tests/security/qa-parity.generated.rules tests/security/firestore.rules
  sha256sum tests/security/firestore.rules >> "$out/identity.txt"
  (cd tests/security && exec ./node_modules/.bin/firebase emulators:start --only auth,firestore --project demo-atrio-v11) \
    > "$tls/firebase.log" 2>&1 &
  firebase_pid=$!
  ready=0
  for attempt in $(seq 1 90); do
    kill -0 "$firebase_pid"
    if curl --noproxy '*' -s --max-time 1 -o /dev/null http://127.0.0.1:9099/ &&
       curl --noproxy '*' -s --max-time 1 -o /dev/null http://127.0.0.1:8089/; then ready=1; break; fi
    sleep 2
  done
  [[ "$ready" == 1 ]]
  for port in 8095 9099 8089; do adb reverse "tcp:$port" "tcp:$port"; done
  node tests/security/serve-item13-android-https-qa.mjs seed | tee "$out/seed.log"
  bash scripts/qa-android-prebuild.sh await
  apk=app/build/outputs/apk/qaGeral/app-qaGeral.apk
  aapt="$(find "$ANDROID_HOME/build-tools" -type f -name aapt2 | sort -V | tail -n1)"
  test "$("$aapt" dump packagename "$apk")" = br.com.atriocatolico.qageral.celular
  sha256sum "$apk" >> "$out/identity.txt"
  "$aapt" dump xmltree --file AndroidManifest.xml "$apk" | grep 'android:networkSecurityConfig' >> "$out/identity.txt"
  sanitize_xml() {
    python3 - "$1" "$out" <<'PY'
from pathlib import Path
import sys,xml.etree.ElementTree as E,re,hashlib
label,out=sys.argv[1],Path(sys.argv[2])
files=list(Path('app/build/outputs/androidTest-results/connected/qaGeral').rglob('TEST-*.xml'))
assert len(files)==1, 'expected one JUnit XML'
p=files[0]; raw=p.read_bytes(); root=E.fromstring(raw)
attrs={k:root.get(k,'0') for k in ('tests','failures','errors','skipped')}
attrs['name']='ScopedCaseHttpsE2eAndroidTest'
attrs['source_sha256']=hashlib.sha256(raw).hexdigest()
clean=E.Element('testsuite',attrs)
cases=list(root.iter('testcase'))
for t in cases:
    row=E.SubElement(clean,'testcase',{k:t.get(k,'') for k in ('name','classname','time')})
    for kind in ('failure','error','skipped'):
        for f in t.findall(kind):
            item=E.SubElement(row,kind)
            # No payload, token, account, email, or arbitrary diagnostic text.
            lines=re.findall(r'ScopedCaseHttpsE2eAndroidTest\.kt:\d+',f.text or '')
            typ=f.get('type','')
            item.text=('exception='+typ if re.fullmatch(r'[\w.$]+',typ) else 'exception=redacted')+' '+','.join(lines)
E.ElementTree(clean).write(out/(label+'.xml'),encoding='utf-8',xml_declaration=True)
print(label,attrs)
assert len(cases)==1 and int(attrs['tests'])==1 and all(int(attrs[k])==0 for k in ('failures','errors','skipped'))
PY
  }
  start_server() {
    local mode="$1" label="$2" cert="$3"
    node tests/security/serve-item13-android-https-qa.mjs "$mode" "$tls/server.key" "$tls/$cert.pem" > "$out/$label-host.log" 2>&1 &
    server_pid=$!
    for attempt in $(seq 1 45); do
      kill -0 "$server_pid"
      if grep -qx "listen $mode loopback_only" "$out/$label-host.log"; then return 0; fi
      sleep 1
    done
    return 1
  }
  stop_server() {
    kill "$server_pid"; wait "$server_pid" 2>/dev/null || true; server_pid=
  }
  run_test() {
    local label="$1" method="$2" result=0
    gradle :app:connectedQaGeralAndroidTest \
      "-Pandroid.testInstrumentationRunnerArguments.class=br.com.atriocatolico.ScopedCaseHttpsE2eAndroidTest#$method" \
      --daemon --stacktrace > "$tls/$label-gradle.log" 2>&1 || result=$?
    sanitize_xml "$label"
    [[ "$result" == 0 ]]
  }
  for cert in untrusted wrong; do
    start_server reject "$cert" "$cert"
    run_test "$cert" invalidTlsIsRejectedByBothRealClients
    grep -qx tls_client_error "$out/$cert-host.log"
    ! grep -q unexpected_http_request "$out/$cert-host.log"
    stop_server
  done
  start_server serve trusted good
  curl --noproxy '*' --cacert "$tls/ca.pem" -fsS --max-time 5 https://127.0.0.1:8095/health >/dev/null
  run_test trusted realWorkflowDmAndGroupWithAccountSwitchAndRevocation
  node tests/security/serve-item13-android-https-qa.mjs verify | tee "$out/firestore-verification.log"
  ! grep -qE 'harness_error|unexpected_http_request' "$out/trusted-host.log"
  for channel in direct group; do
    for route in open state action appeal; do
      grep -Eq "^https channel=$channel route=$route status=200 tls=TLSv1\.[23] auth_checked=true no_store=true$" "$out/trusted-host.log"
      grep -Eq "^https channel=$channel route=$route status=404 tls=TLSv1\.[23] auth_checked=true no_store=true$" "$out/trusted-host.log"
    done
    grep -qx "fixture channel=$channel reassigned_after_same_reviewer_denial" "$out/trusted-host.log"
    grep -qx "fixture channel=$channel revoked_after_review_revalidation" "$out/trusted-host.log"
  done
  stop_server
  echo 'item13 HTTPS E2E PASS' | tee "$out/result.txt"
  ;;
*) exit 2 ;;
esac
