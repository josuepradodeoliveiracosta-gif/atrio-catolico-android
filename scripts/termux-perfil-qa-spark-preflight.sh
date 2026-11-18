#!/usr/bin/env bash
# Agente 2: verifica SOMENTE metadados. NUNCA cria ou altera recursos.
# Projeto de destino pretendido: atrio-catolico-qa-perfil (ainda nao criado).
set -euo pipefail

TARGET='atrio-catolico-qa-perfil'

fail() {
  printf 'RESULTADO=BLOQUEADO\nMOTIVO=%s\n' "$1" >&2
  exit 1
}

if [[ $# -ne 0 ]]; then
  fail 'Este preflight nao aceita argumentos.'
fi
if ! command -v firebase >/dev/null 2>&1; then
  fail 'Firebase CLI indisponivel no Termux.'
fi
if ! command -v jq >/dev/null 2>&1; then
  fail 'jq indisponivel no Termux.'
fi

printf 'AGENTE=2_FIREBASE\nOPERACAO=LEITURA_DE_METADADOS\nPROJETO_PRETENDIDO=%s\n' "$TARGET"
# Consulta apenas a lista de projetos acessiveis a conta autenticada.
# Nao cria, altera, habilita billing ou faz deploy.
if ! payload="$(firebase projects:list --json)"; then
  fail 'Consulta de projetos falhou; conferir login/permissoes sem divulgar tokens.'
fi
if ! printf '%s\n' "$payload" | jq -e '
  .result | if type == "array" then all(.[]; (.projectId | type) == "string") else false end
' >/dev/null; then
  fail 'Formato inesperado da resposta Firebase CLI; nenhuma criacao deve ocorrer.'
fi
count="$(printf '%s\n' "$payload" | jq -r '.result | length')"
exists="$(printf '%s\n' "$payload" | jq -r --arg target "$TARGET" '.result | any(.[]; .projectId == $target)')"
printf 'PROJETOS_VISIVEIS=%s\n' "$count"
if [[ "$exists" == 'true' ]]; then
  printf 'RESULTADO=BLOQUEADO_EXISTENTE\nMOTIVO=ID ja aparece entre os projetos acessiveis. Nao criar nem reutilizar sem investigar.\n'
  exit 2
fi
printf 'RESULTADO=PRE_FLIGHT_LEITURA_OK\n'
printf 'AVISO=ID nao consta na conta consultada; disponibilidade global, cota, Spark e billing NAO foram confirmados.\n'
printf 'PROXIMO_PASSO=Autorizacao especifica do fundador antes de criar qualquer recurso.\n'
