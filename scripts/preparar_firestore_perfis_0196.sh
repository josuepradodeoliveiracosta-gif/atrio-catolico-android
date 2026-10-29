#!/usr/bin/env bash
# Auditoria somente de leitura. NAO publica regras, indices ou dados.
set -euo pipefail

PROJECT_ID="atrio-catolico"
EXPECTED_BRANCH="feature/perfis-publicos-0196"

for required in git firebase python3; do
  command -v "$required" >/dev/null || { echo "FALHA: comando ausente: $required" >&2; exit 1; }
done

[[ -f firebase.json && -f firestore.rules && -f firestore.indexes.json ]] ||
  { echo "FALHA: execute na raiz do repositorio da PR #42, nao em atrio-regras-0194." >&2; exit 1; }

actual_branch="$(git branch --show-current)"
[[ "$actual_branch" == "$EXPECTED_BRANCH" ]] ||
  { echo "FALHA: branch $actual_branch; esperada $EXPECTED_BRANCH. Nao use a main ou a pasta antiga." >&2; exit 1; }

python3 - <<'PY'
import json
from pathlib import Path

config = json.loads(Path("firebase.json").read_text())
assert config.get("firestore", {}) == {
    "rules": "firestore.rules", "indexes": "firestore.indexes.json"
}, "firebase.json nao aponta exclusivamente aos arquivos revisados"
data = json.loads(Path("firestore.indexes.json").read_text())
expected = [{
    "collectionGroup": "posts", "queryScope": "COLLECTION",
    "fields": [
        {"fieldPath": "uid", "order": "ASCENDING"},
        {"fieldPath": "createdAt", "order": "DESCENDING"}
    ]
}]
assert data.get("indexes") == expected, "indice local difere do revisado na PR #42"
assert data.get("fieldOverrides") == [], "fieldOverrides inesperado"
rules = Path("firestore.rules").read_text()
assert "match /public_profiles/{uid}" in rules
assert "allow list: if false;" in rules
assert "getAfter(/databases/$(database)/documents/profiles/$(uid)).data" in rules
print("OK: regras, indice e configuracao local presentes.")
PY

echo "Consultando indices existentes (somente leitura)..."
current="$(firebase firestore:indexes --project "$PROJECT_ID")"
ATRIO_REMOTE_INDEXES="$current" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ATRIO_REMOTE_INDEXES"])
indexes = data.get("indexes", [])
overrides = data.get("fieldOverrides", [])
assert indexes == [], (
    "INDICES REMOTOS ALTERADOS DESDE O LEVANTAMENTO: rever e mesclar antes de qualquer deploy"
)
assert overrides == [], (
    "OVERRIDES REMOTOS EXISTENTES: rever e preservar antes de qualquer deploy"
)
print("OK: nenhum indice composto personalizado ou override remoto detectado.")
PY

echo "SHA local: $(git rev-parse HEAD)"
echo "AUDITORIA LOCAL APROVADA. Nada foi publicado."
echo "PENDENTE: comparar regras vigentes no Console Firebase com firestore.rules,"
echo "revalidar CI e obter autorizacao separada antes de qualquer deploy."
