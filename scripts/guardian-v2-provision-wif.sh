#!/usr/bin/env bash
# Átrio Guardião V2 — provisionamento manual, sem chave permanente.
# Execute apenas no Google Cloud Shell da conta administradora.
# O comando de criação NÃO ativa o agendamento nem a moderação; o workflow
# GitHub continuará bloqueado pelas variables e pela política Firestore.
set -Eeuo pipefail

PROJECT="atrio-catolico"
PROJECT_NUMBER="256733686427"
SA="guardian-v2-writer@${PROJECT}.iam.gserviceaccount.com"
POOL="guardian-v2-writer"
PROVIDER="github-moderator"
ROLE_ID="guardianV2CaseWriter"
REPO_ID="1432799501"
OWNER_ID="347622360"
REPO="josuepradodeoliveiracosta-gif/atrio-catolico-android"
WORKFLOW="${REPO}/.github/workflows/guardiao-v2-moderator-runner.yml@refs/heads/main"
CONDITION="assertion.repository_id=='${REPO_ID}' && assertion.repository_owner_id=='${OWNER_ID}' && assertion.ref=='refs/heads/main' && assertion.workflow_ref=='${WORKFLOW}' && assertion.environment=='guardian-v2-production-moderation'"
PERMISSIONS="datastore.databases.get,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update"
PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_id/${REPO_ID}"

if [[ "${1:-}" != "--apply" ]]; then
  echo "Modo informativo: para aplicar, execute bash scripts/guardian-v2-provision-wif.sh --apply"
  echo "Escopo: cria identidade separada, WIF e papel sem delete. NÃO ativa produção."
  exit 0
fi
command -v gcloud >/dev/null || { echo "Use Google Cloud Shell com gcloud."; exit 2; }
ACTIVE="$(gcloud config get-value project 2>/dev/null)"
[[ "$ACTIVE" == "$PROJECT" ]] || {
  echo "Projeto atual é '$ACTIVE'; esperado '$PROJECT'. Execute gcloud config set project $PROJECT."; exit 3;
}
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
[[ "$NUMBER" == "$PROJECT_NUMBER" ]] || { echo "Número do projeto divergente; abortando."; exit 4; }
echo "Projeto validado. Preparando identidade dedicada sem chave JSON."

if ! gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create guardian-v2-writer --project="$PROJECT" \
    --display-name="Átrio Guardião V2 — somente casos e revisão" --quiet
fi

if ! gcloud iam roles describe "$ROLE_ID" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam roles create "$ROLE_ID" --project="$PROJECT" \
    --title="Guardião V2 - casos e revisão sem exclusão" \
    --description="Leitura e criação/edição de casos; nenhuma permissão de exclusão ou administração" \
    --permissions="$PERMISSIONS" --stage=GA --quiet
else
  # Não confiar em uma role antiga com o mesmo nome: recusá-la se ampla.
  EXISTING="$(gcloud iam roles describe "$ROLE_ID" --project="$PROJECT" --format='value(includedPermissions)' | tr ';' '\n' | tr ',' '\n' | sed '/^$/d' | sort)"
  EXPECTED="$(tr ',' '\n' <<<"$PERMISSIONS" | sort)"
  [[ "$EXISTING" == "$EXPECTED" ]] || {
    echo "ATENÇÃO: role existente com permissões diferentes. Nenhuma elevação aplicada."; exit 5;
  }
fi

if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT" \
    --display-name="Guardião V2 Writer GitHub" --quiet
fi

if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global --project="$PROJECT" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
    --attribute-condition="$CONDITION" --quiet
else
  ACTUAL="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global --project="$PROJECT" \
    --format='value(attributeCondition)')"
  [[ "$ACTUAL" == "$CONDITION" ]] || {
    echo "Condição WIF existente diferente do limite esperado; NÃO vincular."; exit 6;
  }
fi

gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT" \
  --member="$PRINCIPAL" --role="roles/iam.workloadIdentityUser" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="projects/$PROJECT/roles/$ROLE_ID" --quiet >/dev/null

echo "IDENTIDADE_V2_CRIADA_SEM_DELETE — conta WIF dedicada; nenhuma moderação ativada."
echo "O projeto ainda precisa de políticas, backend e autorização explícita do workflow."
