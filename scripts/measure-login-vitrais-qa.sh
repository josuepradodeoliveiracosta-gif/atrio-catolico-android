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

# Comparação A/B com a base exata da PR. Checkout temporário sem credenciais,
# sem instalar APK em aparelho físico e sem escrever na branch principal.
base_sha=be1756ff036efdde1aa6529a6268dfe5951d77a3
if ! git cat-file -e "$base_sha^{commit}" 2>/dev/null; then
  git fetch --no-tags --depth=1 origin "$base_sha"
fi
test "$(git rev-parse "$base_sha^{commit}")" = "$base_sha"
base_dir="$(mktemp -d "${RUNNER_TEMP:?}/atrio-vitrais-base.XXXXXX")"
git archive "$base_sha" | tar -x -C "$base_dir"
# Mesma política de isolamento que o checkout do candidato.
rm -f -- "$base_dir/app/google-services.json"
for config in app/src/qaGeral/google-services.json app/src/chatQa/google-services.json app/src/perfilQa/google-services.json; do
  test ! -e "$base_dir/$config"
done
for key in ATRIO_PUSH_WORKER_URL ATRIO_GUARDIAN_V2_WORKER_URL ATRIO_AVATAR_WORKER_URL GOOGLE_APPLICATION_CREDENTIALS ATRIO_SIGNING_STORE_FILE ATRIO_SIGNING_STORE_PASSWORD ATRIO_SIGNING_KEY_ALIAS ATRIO_SIGNING_KEY_PASSWORD; do
  test -z "${!key:-}"
done
(cd "$base_dir" && gradle :app:assembleQaGeral --no-daemon --stacktrace --max-workers=2) > "$report/base-build.log" 2>&1
base_apk="$base_dir/app/build/outputs/apk/qaGeral/app-qaGeral.apk"
test -f "$base_apk"
test "$("$aapt" dump packagename "$base_apk")" = "$pkg"
# Sete pares, invertendo a ordem em pares alternados para reduzir viés.
for trial in 1 2 3 4 5 6 7; do
  if (( trial % 2 == 1 )); then labels=(base candidate); else labels=(candidate base); fi
  for label in "${labels[@]}"; do
    if [[ "$label" == base ]]; then sample_apk="$base_apk"; else sample_apk="$apk"; fi
    adb shell am force-stop "$pkg"
    adb install -r "$sample_apk" > "$report/ab-$label-install-$trial.log"
    adb shell am force-stop "$pkg"
    timeout 45s adb shell am start -W -n "$pkg/br.com.atriocatolico.MainActivity" \
      | tr -d '\r' | tee "$report/ab-$label-$trial.txt"
    grep -Eq '^Status: ok$' "$report/ab-$label-$trial.txt"
    grep -Eq '^TotalTime: [0-9]+$' "$report/ab-$label-$trial.txt"
  done
done
adb shell am force-stop "$pkg"
python3 - "$report" "$base_apk" "$apk" "$base_sha" "$(git rev-parse HEAD)" <<'PY'
import json, pathlib, re, statistics, sys, zipfile
report, base, candidate = map(pathlib.Path, sys.argv[1:4])
def times(label):
    return [int(re.search(r"(?m)^TotalTime: (\d+)$", (report / f"ab-{label}-{i}.txt").read_text())[1]) for i in range(1, 8)]
with zipfile.ZipFile(base) as z:
    assert not any(n.startswith("assets/login-vitrais/") for n in z.namelist())
a, b = times("base"), times("candidate")
base_size, candidate_size = base.stat().st_size, candidate.stat().st_size
base_median, candidate_median = statistics.median(a), statistics.median(b)
assert base_size > 0 and base_median > 0
result = {
    "base_sha": sys.argv[4], "candidate_checkout_sha": sys.argv[5],
    "base_apk_bytes": base_size, "candidate_apk_bytes": candidate_size,
    "apk_delta_bytes": candidate_size - base_size,
    "apk_delta_percent": round(100 * (candidate_size - base_size) / base_size, 2),
    "base_cold_start_ms": a, "candidate_cold_start_ms": b,
    "base_median_ms": base_median, "candidate_median_ms": candidate_median,
    "median_delta_ms": candidate_median - base_median,
    "paired_delta_ms": [y-x for x,y in zip(a,b)],
    "paired_median_delta_ms": statistics.median(y-x for x,y in zip(a,b)),
    "median_delta_percent": round(100 * (candidate_median - base_median) / base_median, 2),
    "note": "Mesmo AVD e variante qaGeral, sete pares com ordem alternada, processo a frio. Não mede login totalmente pronto nem desempenho de celular."
}
(report / "base-comparison.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
PY
