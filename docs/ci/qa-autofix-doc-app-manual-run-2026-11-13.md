# Homologação GitHub App — execução manual de uma PR documental draft

**Data: 13/11/2026.** Este marco integra os controles para que a GitHub
App `atrio-qa-autofix` com chave protegida no ambiente `atrio-autofix-qa`
possa, quando o proprietário acioná-la explicitamente, demonstrar as
permissões reais `Contents:write` e `Pull requests:write` criando
**uma única PR em rascunho** restrita a um documento QA.

## Workflow exclusivo, sem execução automática

Arquivo: `.github/workflows/qa-doc-app-draft-manual.yml`

- Acionamento **apenas por `workflow_dispatch`**, exclusivamente na
  `main`, por `josuepradodeoliveiracosta-gif` como actor original e
  como triggering_actor (impede rerun por outras identidades).
- Inputs obrigatórios: `expected_main_sha` (SHA integral de main)
  e `confirmation` (texto literal
  `CREATE_ONE_ATRIO_DOCUMENT_QA_DRAFT_ONLY`). O commit entregue
  deve ser idêntico a `github.sha` e ao checkout local.
- Job 1 executa contratos offline e a prova do documento **antes**
  de acessar qualquer chave. Job 2, condicionado ao sucesso,
  roda no environment protegido `atrio-autofix-qa`, restrito à
  branch `main` e sem deployment.
- O job de escrita usa `GITHUB_TOKEN` com **contents:read**
  e `actions/create-github-app-token@v3` para emitir token
  efêmero de **um repositório**, somente Contents:write e
  Pull requests:write. A chave privada jamais sai do GitHub Actions.
- O token é fornecido via env somente ao processo Python, sem
  comandos de diagnóstico que ecoem variáveis. A App revoga o token
  ao final do job.
- A função `execute_manually_authorized_document_draft` realiza
  leituras de integridade e, se elegível, **no máximo três
  operações remotas** na ordem: criar branch QA fixa, atualizar
  documento pinado, abrir PR `draft=true`.
- NUNCA faz merge, deploy, force push, deletes, retries, alteração
  de Firebase/Cloudflare, acesso a dados reais, custos ou backups.
  Qualquer falha parcial exige inspeção humana: é proibido repetir
  cegamente a execução ou limpar branch.

## Evidência e limites

- A PR de código da transação (PR #267) foi integrada e os testes
  fake HTTP demonstraram somente a lógica, **não a escrita real**.
- O `atrio-autofix-qa` já passou smoke de autenticação com
  `Contents:read` (GitHub Actions #43441065755).
- O documento original ainda possui blob Git
  `12f8eecb3c4cb203c60f8f2bfeaf0fd476873a95`,
  e branch `qa/autofix-doc-history-v1` não existia no início
  desta preparação. O executor sempre reconfere esses estados
  no momento da execução.
- **Este PR adiciona somente o workflow manual, testes e documentação;
  não executa a transação real e não é autorização para modificar
  produção, backups ou fazer merge de outra PR.**
- O workflow precisa primeiro estar integrado à `main`, mediante
  autorização expressa de merge, porque `workflow_dispatch`
  exige arquivo presente na branch padrão. Depois o proprietário
  deve efetuar um dispatch manual com SHA atual, prova literal,
  e revisar o run e a PR resultante.

## Exemplo de acionamento no Termux, após merge autorizado

```sh
REPO=josuepradodeoliveiracosta-gif/atrio-catolico-android
SHA="$(gh api "repos/$REPO/branches/main" --jq '.commit.sha')"
gh workflow run qa-doc-app-draft-manual.yml --ref main --repo "$REPO" \
  -f expected_main_sha="$SHA" \
  -f confirmation=CREATE_ONE_ATRIO_DOCUMENT_QA_DRAFT_ONLY
gh run list --workflow qa-doc-app-draft-manual.yml --limit 3 --repo "$REPO"
```

Os comandos só devem ser apresentados para execução **depois** de
revisados os checks e autorizado o merge desta PR. Mesmo diante de
`failure`, nunca disparar uma segunda vez sem analisar se a
branch parcial foi criada.
