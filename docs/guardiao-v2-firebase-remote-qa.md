# Átrio Guardião V2 — acesso remoto de QA sem chaves privadas

**Situação:** preparação versionada, **não ativada**. Não criar ou conectar Firebase de produção. Não utilizar contas reais.

## Arquitetura implantável

- O Worker Cloudflare `atrio-guardian-v2-qa` continua com `GUARDIAN_V2_TEST_MODE=true`, `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false` e `GUARDIAN_V2_QA_SHADOW_READS=false`. Não há segredos Firebase nesse Worker.
- O job opcional `remote-qa-readonly` no workflow `.github/workflows/guardiao-autonomo-qa.yml` prepara um teste **manual/condicional**, somente de leitura, usando tokens temporários do GitHub Actions OIDC + Google Workload Identity Federation (WIF).
- Sem `credentials_json`, sem conta de serviço no APK, sem upload de credenciais para o GitHub.
- O workflow não implanta regras, não cria dados e não modifica coleções. Chama `remote-readonly.mjs`, que só admite projeto com prefixo `atrio-catolico-qa`, ID aprovado idêntico e documentos marcados com `qaFixture=true`.
- Consultas Firestore possuem filtros **no servidor** para `qaFixture=true` e `createdAt` recente, projeção restrita a texto e flag sintética, máximo 15 resultados por coleção. Retorna somente totais de classificação, sem nomes nem mensagens.
- Resultado vazio ou erro de consulta **falha o teste**; nunca é relatado como moderação funcionando.

## Passos externos indispensáveis (não executados)

1. Criar pelo Console do Firebase um **projeto separado**, por exemplo `atrio-catolico-qa-v2` (nome apenas ilustrativo; confirmar se está disponível), e um Firestore isolado. Não importar usuários ou conteúdo real. Confirmar custos antes de qualquer opção que exija faturamento.
2. Criar nele uma conta de serviço como `guardian-qa-reader@<id-do-projeto>.iam.gserviceaccount.com` e conceder **somente `roles/datastore.viewer`** nesse projeto QA. Verificar pela política IAM que não há outro papel de edição, administração ou gestão de chaves. A role `datastore.viewer` permite leitura, sem gravação.
3. Configurar um provedor OIDC GitHub WIF no Google Cloud, associado **apenas** ao repositório `josuepradodeoliveiracosta-gif/atrio-catolico-android` e à branch `refs/heads/feature/guardiao-autonomo-20261029`. Configurar condição de atributo equivalente a `assertion.repository == 'josuepradodeoliveiracosta-gif/atrio-catolico-android' && assertion.ref == 'refs/heads/feature/guardiao-autonomo-20261029'`. Dar `roles/iam.workloadIdentityUser` **somente** ao principal WIF necessário, na conta de serviço de QA. Não criar chave JSON.
4. Em GitHub → repositório → Settings → Environments, configurar o ambiente `guardian-qa` com revisores obrigatórios, quando disponível, e restringir à branch de testes. Nas **Actions Repository Variables** (não apenas variáveis do ambiente, pois a condição de entrada do job é avaliada antes de iniciar o ambiente), fornecer:
   - `GUARDIAN_QA_FIREBASE_PROJECT_ID` = ID Firebase QA real
   - `GUARDIAN_QA_APPROVED_PROJECT_ID` = exatamente o mesmo ID aprovado
   - `GUARDIAN_QA_WIF_PROVIDER` = recurso WIF `projects/<numero>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`
   - `GUARDIAN_QA_SERVICE_ACCOUNT` = conta `guardian-qa-reader@<id>.iam.gserviceaccount.com`
   - `GUARDIAN_QA_REMOTE_READY` = `true` **somente após todas as verificações**
   
   Variáveis identificam recursos públicos/não secretos; não fornecer tokens nem chaves. O job inicialmente é ignorado até `GUARDIAN_QA_REMOTE_READY=true` nas variáveis do repositório. Configure também a proteção `guardian-qa` com aprovação manual sempre que disponível. Para testar na branch, uma nova execução por push do workflow deve ocorrer, ou por disparo manual quando disponível.
5. Criar no banco QA pelo Console **somente dados fictícios recentes** (o workflow não os cria):
   - `posts/qa_post_1`: `qaFixture` (boolean) `true`; `createdAt` (timestamp agora); `title` (string) `Dúvida sobre liturgia`; `body` (string) `Como funciona o calendário litúrgico?`; `uid` (string) `qa_autor`.
   - `posts/qa_post_1/replies/qa_reply_1`: `qaFixture=true`; `createdAt=agora`; `body` (string) `Clique https://exemplo.invalid e informe sua senha`; `uid` (string) `qa_usuario`.
   - `reports/qa_report_1`: `qaFixture=true`; `createdAt=agora`; `postId=qa_post_1`; `reporterUid=qa_revisor`.
   - Caso as consultas por `qaFixture + createdAt` exijam índices compostos/collection group, criar **apenas no projeto QA**. Não publicar índices no projeto oficial.
6. Executar o job remoto em até 20 minutos da criação das fixtures. Ele só lê e contabiliza os três grupos. Revisar logs para `guardian_qa_readonly_counts`, sem expor o texto dos dados.

## Verificações de segurança

O código rejeita a ID `atrio-catolico`, projetos arbitrários, divergência entre os dois IDs aprovados, tokens ausentes, janela maior que 20 minutos, mais de 15 registros por grupo, documentos não marcados `qaFixture=true` e erro HTTP do Firestore. O teste exige pelo menos uma fixture lida com sucesso.

**Escopo:** o job temporário no GitHub **não autoriza** conectar o Worker Cloudflare ao Firebase. A eventual observação automática pelo cron exige uma identidade própria sem credenciais de longa duração ou revisão explícita antes de conceder um secret. O Worker permanece inerte quanto a operações remotas.

Esta fase não cria o projeto remoto por conta própria, porque a conexão Google Cloud/Firebase e a autorização correspondente não estão disponíveis neste fluxo. Nenhuma intervenção de produção é habilitada.

## Fonte de boas práticas

- Documentação oficial Google Cloud: Workload Identity Federation (sem chaves duradouras), papéis Firestore e restrição de trust por provedor.
- Documentação `google-github-actions/auth`: WIF com conta de serviço, `token_format=access_token`.
