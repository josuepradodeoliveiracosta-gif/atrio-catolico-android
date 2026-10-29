# Guardião V2 — leitura automática de QA SEM chaves (Cloud Run)

**Status:** código e testes adicionados à PR #44, mas **NÃO IMPLANTADO**. O projeto `atrio-catolico-qa-v2` contém apenas dados sintéticos. Não criar recursos no projeto `atrio-catolico`.

## Decisão de arquitetura

A credencial OIDC do GitHub Actions é emitida **ao job**, não ao Worker da Cloudflare. Um Worker da Cloudflare não deve copiar essa credencial, emitir JWTs sem um provedor confiável ou guardar uma chave JSON permanente para obter o mesmo acesso. O agendamento `schedule` do GitHub Actions roda na branch padrão, `main`, e não na feature branch do Guardião. A branch `main` não pode ser alterada sem autorização.

Para observação **automática e sem chave privada**, o leitor em `cloudflare/guardian-worker/qa-cloudrun/{reader.mjs,server.mjs}` pode ser executado no **Google Cloud Run** com a identidade `guardian-qa-reader` já criada, usando o metadata server nativo do Google. Um futuro **Cloud Scheduler** autenticado por OIDC poderá chamar o endpoint privado `POST /run` periodicamente. A Cloudflare QA permanece limitada a monitorar os testes públicos do GitHub; **não tem acesso ao Firestore**.

## Defesas incorporadas ao código

- Projeto permitido exato: `atrio-catolico-qa-v2`, duas variáveis independentes de correspondência. Rejeita `atrio-catolico` e variáveis que tentem ativar moderação, quarentena ou serviço não-qa.
- Serviço somente de leitura associado à identidade exata `guardian-qa-reader@atrio-catolico-qa-v2.iam.gserviceaccount.com`. Obtém token temporário **somente do metadata server do Cloud Run**, sem chave privada, GitHub PAT, conta de serviço externa ou token estático.
- Usa `Firestore.scanQa` com filtro **no servidor** `qaFixture=true` e `createdAt` recente (até 20 min), projeção dos campos de texto apenas quando necessário, limite de 15 itens/coleção e agregação de categorias.
- Nenhum endpoint POST para escrever decisões, avisos, quarentenas ou conteúdo; o único endpoint de trabalho é `POST /run`, sem corpo nem alvo informado por usuário.
- Falhas de autorização, conexão, leitura ou ausência de dados recentes retornam `503 unavailable`, nunca `success`; logs e respostas contêm somente contagens de categorias, sem IDs nem textos de usuários.
- Cloud Run deve ser implantado como serviço **privado**, `--ingress internal --no-allow-unauthenticated`, associado exclusivamente à identidade de leitura QA. Cloud Scheduler requer **outra** identidade com permissão apenas de invocar o serviço privado (não Firestore).
- Não contém serviço automático de criação de dados: os documentos QA atuais expirarão da janela de consulta de 20 minutos. Até definir uma estratégia segura para gerar fixtures fictícias, novas observações podem retornar indisponíveis, corretamente.

## Implantação futura — SOMENTE após aprovação de faturamento e custo

O Cloud Run e o Cloud Scheduler podem **exigir habilitar uma conta de faturamento** para criar serviços, mesmo que parte do uso caiba em franquias gratuitas. Cloud Scheduler concede até três jobs gratuitos por conta de faturamento, conforme política vigente; outras operações (Cloud Run, build, logs, armazenamento e Firestore) podem incorrer custo. NÃO habilitar faturamento, Cloud Scheduler, Cloud Run, Artifact Registry ou Cloud Build automaticamente. Consultar cotas e orçamento antes. Esse passo depende de autorização expressa.

O procedimento abaixo é **referência para revisão, não executar automaticamente**. Em terminal autenticado no projeto QA, após confirmar a conta de faturamento e o orçamento:

```bash
PROJECT="atrio-catolico-qa-v2"
gcloud config set project "$PROJECT"
gcloud billing projects describe "$PROJECT"
gcloud projects get-iam-policy "$PROJECT" --format=json
```

A identidade de execução é a conta já criada:

`guardian-qa-reader@atrio-catolico-qa-v2.iam.gserviceaccount.com`

Para uma eventual implantação aprovada, criar um serviço Cloud Run **no projeto QA e somente nele**, com limites conservadores:

```bash
PROJECT="atrio-catolico-qa-v2"
REGION="southamerica-east1"

# EXEMPLO APENAS — requer autorização explícita para cobrança e implantação.
gcloud run deploy atrio-guardian-qa-reader \
  --source cloudflare/guardian-worker \
  --project "$PROJECT" --region "$REGION" \
  --service-account "guardian-qa-reader@$PROJECT.iam.gserviceaccount.com" \
  --no-allow-unauthenticated --ingress internal \
  --min-instances 0 --max-instances 1 --concurrency 1 \
  --timeout 30s --memory 256Mi --cpu 1 \
  --set-env-vars "GUARDIAN_QA_SERVER=true,GUARDIAN_QA_CLOUD_RUN_ENABLED=true,GUARDIAN_QA_CLOUD_RUN_PROJECT=$PROJECT,GUARDIAN_QA_CLOUD_RUN_ALLOWED_PROJECT=$PROJECT,GUARDIAN_V2_TEST_MODE=true,GUARDIAN_V2_ENABLED=false,GUARDIAN_V2_HOLD_ENABLED=false"
```

O código Node executa o script `npm start` e escuta a porta `PORT` definida pela plataforma; a API `GET /healthz` relata somente a prontidão, e `POST /run` executa a classificação sintética. Para testar sem realizar cobrança externa, use `npm test` no diretório `cloudflare/guardian-worker`.

**Somente se o serviço for aprovado, implantado e protegido:** criar uma conta de serviço separada `guardian-qa-scheduler`, com apenas `roles/run.invoker` no serviço Cloud Run QA. Configurar Cloud Scheduler no MESMO projeto QA para invocar `POST <URL-do-serviço>/run` com OIDC e audiência igual à URL base do serviço, a cada 15 minutos. Não conceder `roles/datastore.viewer` à conta Scheduler; ela apenas invoca o leitor. Executar uma validação de zero escrita e contagem de dados sintéticos após provisionar o serviço.

## Como verificar segurança antes da aprovação

- `npm test` deve executar `qa-cloudrun/reader.test.mjs` além dos testes antigos;
- o ambiente Cloudflare `atrio-guardian-v2-qa` deve continuar sem credenciais e com `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false` e `GUARDIAN_V2_QA_SHADOW_READS=false`;
- a variável GitHub `GUARDIAN_QA_REMOTE_READY` deve estar em `false` após o teste remoto manual;
- a `main`, os backups, o banco oficial e o Worker de notificações permanecem intocados.

Referências: documentação oficial Google [executar Cloud Run em agendamento](https://docs.cloud.google.com/run/docs/triggering/using-scheduler), [identidades de workloads](https://docs.cloud.google.com/iam/docs/workload-identities) e [preço Cloud Scheduler](https://cloud.google.com/scheduler/pricing); GitHub [`schedule` na branch padrão](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
