#!/usr/bin/env bash
# Compile under a disposable OS account. Only the unsigned APK leaves its workspace.
set -euo pipefail
set +x
umask 077

candidate="${1:?Checkout do candidato ausente}"
sha="${2:?SHA do candidato ausente}"
tree="${3:?Árvore do candidato ausente}"
output="${4:?Destino do APK ausente}"
mode="${5:-registered}"
test ! -e "$output"
test ! -L "$output"
python3 -m scripts.qa_geral_celular_round42 source "$candidate" "$sha" "$tree"

sandbox="$(mktemp -d /tmp/qa42-build.XXXXXX)"
builder="qa42-${sandbox##*.}"
builder_uid=
cleanup() {
    if [[ -n "$builder_uid" ]]; then
        sudo pkill -KILL -u "$builder_uid" || true
        sudo userdel "$builder"
    fi
    sudo rm -rf -- "$sandbox"
}
trap cleanup EXIT
chmod 0711 "$sandbox"
mkdir "$sandbox/source" "$sandbox/home" "$sandbox/out" "$sandbox/home/tmp"
gradle_bin="$(readlink -f "$(command -v gradle)")"
gradle_root="$(dirname "$(dirname "$gradle_bin")")"
test -f "$gradle_root/lib/gradle-launcher-8.13.jar"
mkdir "$sandbox/gradle"
cp -a "$gradle_root/." "$sandbox/gradle/"
chmod -R a+rX,go-w "$sandbox/gradle"
git -C "$candidate" archive "$sha" -- . ':(exclude)app/google-services.json' |
    tar -x -C "$sandbox/source"

case "$mode" in
    fixture)
        python3 - > "$sandbox/home/firebase.json" <<'PY'
import json
from scripts.qa_geral_remote_build_gate import QA_PROJECT, REGISTERED_APP_ID, fixture

config = fixture(QA_PROJECT, REGISTERED_APP_ID)
config["client"][0]["api_key"][0]["current_key"] = "sem-credencial-remota-ensaio-42"
print(json.dumps(config))
PY
        ;;
    registered)
        printf '%s' "${ATRIO_QA_CELULAR_GOOGLE_SERVICES_JSON:?Configuração de QA ausente}" \
            > "$sandbox/home/firebase.json"
        ;;
    *) echo "Modo de build inválido." >&2; exit 2 ;;
esac
unset ATRIO_QA_CELULAR_GOOGLE_SERVICES_JSON

sudo useradd --system --no-create-home --home-dir "$sandbox/home" --shell /usr/sbin/nologin "$builder"
builder_uid="$(id -u "$builder")"
sudo chown -R "$builder_uid" "$sandbox/source" "$sandbox/home" "$sandbox/out"
sudo -u "$builder" -- test ! -w "${GITHUB_WORKSPACE:?Área do workflow ausente}"
sudo -u "$builder" -- test ! -w "${RUNNER_TEMP:?Área privada do runner ausente}"
sudo -u "$builder" -- test -x "$sandbox/gradle/bin/gradle"
sudo -u "$builder" -- test ! -w "$sandbox/gradle/bin/gradle"
printf 'Build isolado: UID %s, staging %s\n' "$builder_uid" "$sandbox"
echo 'Gradle 8.13 somente leitura. Usuário do build sem escrita no workspace GitHub e na área privada do runner.'
sudo -u "$builder" -- env -i \
    HOME="$sandbox/home" PATH="$sandbox/gradle/bin:$PATH" TMPDIR="$sandbox/home/tmp" \
    JAVA_HOME="$JAVA_HOME" ANDROID_HOME="$ANDROID_HOME" \
    bash -c '
        set -euo pipefail
        version="$(gradle --version)"
        printf "%s\n" "$version"
        printf "%s\n" "$version" | grep -Fxq "Gradle 8.13"
        cd "$1/source"
        export ATRIO_QA_CELULAR_GOOGLE_SERVICES_JSON="$(cat "$HOME/firebase.json")"
        rm -- "$HOME/firebase.json"
        bash scripts/qa_geral_celular_manual.sh build-round-42 "$1/out/unsigned.apk"
    ' bash "$sandbox"
sudo pkill -KILL -u "$builder_uid" || true
if sudo pgrep -u "$builder_uid" >/dev/null; then
    echo 'Ainda há processos do usuário de build.' >&2
    exit 1
fi
input="$sandbox/out/unsigned.apk"
sudo test -f "$input"
sudo test ! -L "$input"
sudo install -m 600 -o "$(id -u)" -g "$(id -g)" -- "$input" "$output"
printf 'APK de entrada encaminhado: %s\n' "$(sha256sum < "$output" | cut -d' ' -f1)"
