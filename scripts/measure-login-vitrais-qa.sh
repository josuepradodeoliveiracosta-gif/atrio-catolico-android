#!/usr/bin/env bash
# Evidência de tamanho e primeira janela a frio. Exclusivo ao emulador efêmero de CI.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "${CI:-}" == true && "${ATRIO_QA_SUITE_GROUP:-}" == interaction &&
   "${ATRIO_QA_APK:-}" == qaGeral && "${ATRIO_QA_GERAL_BUILD:-}" == 1 &&
   "${ATRIO_QA_FIREBASE_PROJECT:-}" == demo-atrio-v11 &&
   "${ATRIO_QA_GERAL_REMOTE_BUILD:-}" != 1 &&
   "${ATRIO_QA_GERAL_CELULAR_PILOT:-}" != 1 ]] || {
  echo "Medição permitida somente no CI QA Geral isolado" >&2; exit 2;
}
test ! -e app/google-services.json
apk=app/build/outputs/apk/qaGeral/app-qaGeral.apk
report=qa-android-suite-results/login-vitrais-metrics
mkdir -p "$report"
test -f "$apk"
python3 - "$apk" "$report/apk-size.json" <<'PY'
import hashlib, json, pathlib, sys, zipfile
apk, output = map(pathlib.Path, sys.argv[1:])
prefix = "assets/login-vitrais/"
manifest = {}
for line in pathlib.Path("docs/vitrais-login.sha256").read_text().splitlines():
    digest, name = line.split()
    manifest[prefix + name] = digest
assert len(manifest) == 6
with zipfile.ZipFile(apk) as z:
    entries = [i for i in z.infolist() if i.filename.startswith(prefix) and not i.is_dir()]
    assert len(entries) == 6 and {i.filename for i in entries} == set(manifest)
    for entry in entries:
        assert hashlib.sha256(z.read(entry)).hexdigest() == manifest[entry.filename], entry.filename
    metrics = {
        "apk_bytes": apk.stat().st_size,
        "vitral_uncompressed_bytes": sum(i.file_size for i in entries),
        "vitral_compressed_payload_bytes": sum(i.compress_size for i in entries),
        "apk_sha256": hashlib.file_digest(apk.open("rb"), "sha256").hexdigest(),
        "assets": [{"name": i.filename, "bytes": i.file_size, "compressed_bytes": i.compress_size} for i in entries],
        "note": "Payload dos vitrais no APK candidato; não é o delta de dois APKs compilados."
    }
output.write_text(json.dumps(metrics, indent=2) + "\n")
print(json.dumps(metrics))
PY
pkg=br.com.atriocatolico.qageral
aapt="$(find "$ANDROID_HOME/build-tools" -type f -name aapt2 | sort -V | tail -n1)"
test -n "$aapt"
test "$("$aapt" dump packagename "$apk")" = "$pkg"
# Runner efêmero dedicado: não interagir com celulares nem pacotes de produção.
test "$(adb get-serialno)" != unknown
[[ "$(adb get-serialno)" == emulator-* ]]
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
adb install -r "$apk" > "$report/install.log"
for trial in 1 2 3; do
  adb shell am force-stop "$pkg"
  timeout 45s adb shell am start -W -n "$pkg/br.com.atriocatolico.MainActivity" \
    | tr -d '\r' | tee "$report/cold-start-$trial.txt"
  grep -Eq '^Status: ok$' "$report/cold-start-$trial.txt"
  grep -Eq '^TotalTime: [0-9]+$' "$report/cold-start-$trial.txt"
done
adb shell am force-stop "$pkg"
python3 - "$report" <<'PY'
import json, pathlib, re, statistics, sys
p = pathlib.Path(sys.argv[1])
samples = [int(re.search(r"(?m)^TotalTime: (\d+)$", (p / f"cold-start-{i}.txt").read_text())[1]) for i in range(1,4)]
metrics = {"activity_total_time_ms": samples, "median_ms": statistics.median(samples),
           "note": "Abertura de processo a frio no emulador; não mede login totalmente pronto, nem desempenho físico."}
(p / "cold-start-summary.json").write_text(json.dumps(metrics, indent=2) + "\n")
print(json.dumps(metrics))
PY
