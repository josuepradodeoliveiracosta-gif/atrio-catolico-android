#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if ! command -v gh >/dev/null || ! command -v git >/dev/null; then
  echo 'Instale git e gh antes: pkg install git gh'
  exit 1
fi
if [ ! -f app/google-services.json ] || [ ! -f .github/workflows/build-apk.yml ]; then
  echo 'ERRO: execute este script na pasta extraida do projeto Atrio Catolico.'
  exit 1
fi
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo 'Este diretorio ja tem um repositorio Git; interrompido para nao sobrescrever.'
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo 'Entre na conta GitHub: gh auth login --web'
  exit 1
fi
GH_USER="$(gh api user --jq '.login')"
GH_ID="$(gh api user --jq '.id')"
echo "Conta GitHub: $GH_USER"

gh auth setup-git
git init -b main
git config user.name "$GH_USER"
git config user.email "${GH_ID}+${GH_USER}@users.noreply.github.com"
git add -A
if ! git ls-files --error-unmatch app/google-services.json >/dev/null 2>&1; then
  echo 'ERRO: arquivo Firebase nao foi incluido. Publicacao cancelada.'
  exit 1
fi
git commit -m 'Primeira versao Android com Firebase e GitHub Actions'
# Escolha um nome novo se o nome padrao ja existir no GitHub.
if ! gh repo create atrio-catolico-android --private --source=. --remote=origin --push; then
  echo 'Nao foi possivel criar o repositorio. Confira o erro acima.'
  echo 'Se o nome ja existir, use: gh repo create atrio-catolico-android-2 --private --source=. --remote=origin --push'
  exit 1
fi
echo 'Repositório criado com sucesso.'
echo 'Acesse GitHub > repositorio atrio-catolico-android > Actions.'
