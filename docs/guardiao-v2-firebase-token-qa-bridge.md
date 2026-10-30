# Guardião V2 — conexão sem chave Firebase, limitada a fixture QA

**Pré-lançamento, sem usuários reais.** Esta fase não liga moderação em produção e não transforma o cron QA em um scanner 24/7. O código está apenas na PR #44 da branch `feature/guardiao-autonomo-20261029`.

## Experimento seguro implementado

A Cloud Firestore REST API suporta dois tipos de token:
- ID token do **Firebase Authentication**: as **Firestore Security Rules** determinam quais documentos o portador pode acessar.
- OAuth token de **conta de serviço**: IAM decide o acesso e pode contornar as regras do cliente.

Fonte oficial: https://firebase.google.com/docs/firestore/use-rest-api

O módulo `cloudflare/guardian-worker/src/qa-user-firestore-bridge.js` utiliza **exclusivamente o primeiro caminho**. A rota de laboratório `POST /qa/firebase-fixture`:

1. Falha com HTTP 503, por padrão, pois `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false`.
2. Quando habilitada **num QA autorizado**, exige `TEST_MODE=true`, `ENABLED=false`, `HOLD_ENABLED=false`, `QA_SHADOW_READS=false`, `QA_AUTO_DISPATCH=false`, `QA_DISPATCH_READY=false`, `QA_READER_PROJECT=atrio-catolico-qa-v2`, **nenhum JSON de service account** e **nenhum projeto de produção** nas variáveis de backend.
3. Recebe um único cabeçalho `Authorization: Bearer <Firebase ID token>` de um usuário **do Firebase Auth do projeto QA**. O Worker **não confia em claims JWT não verificados localmente**: ele repassa o token para a API oficial Firestore que valida o token e **aplica as próprias regras de segurança**. Um token Firebase oficial do projeto `atrio-catolico` não autoriza um usuário no projeto `atrio-catolico-qa-v2`.
4. Faz, no máximo, **um GET por requisição** no endereço **literal e imutável** `projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1`. Não aceita ID, projeto, coleção ou campo enviados pelo cliente; nem JSON ou corpo no POST. Esse endpoint Cloudflare não chama endpoints de escrita.
5. Só classifica quando o Firestore retorna exatamente esse documento com `qaFixture=true`, campos de texto válidos e limites de tamanho. A resposta contém **apenas** `qa_fixture_clear`, `qa_fixture_review` ou `qa_fixture_warn`, nunca texto, UID, ID de documento, cabeçalho de autenticação, dados de perfil ou valores arbitrários retornados pelo Firebase.
6. Em credenciais inválidas, regras negadas, documento inexistente, API indisponível ou formato inesperado, retorna erro genérico **sem bypass**. É apenas leitura e não atualiza `guardian_cases`, `guardian_runtime`, `guardiao_quarantine` ou outros dados.

## Atenção: o que isto NÃO faz

- **Não é um serviço de moderação 24/7.** O cron continua executando apenas os cinco exemplos sintéticos da política; esta rota exigiria um usuário QA autenticado fazendo a requisição.
- **Não é login administrativo** nem substitui autenticação do servidor. As permissões continuam sendo as do próprio usuário Firebase sob Security Rules.
- **Não verifica revogação de token de maneira adicional** (depende do Firebase na consulta).
- A rota deve ficar **DESLIGADA** até confirmar uma conta de teste criada **no Auth do Firebase QA**, regras QA apropriadas e limites de chamadas. A flag `false` evita consumo de reads por endpoint público.
- Um usuário legítimo pode gerar muitas solicitações, consumindo a quota gratuita do Firestore; não ativar a rota para tráfego externo sem rate limit e verificação de uso. O Worker não dispõe ainda de limite persistente por UID.
- Um token do Firebase oficial **não pode** ser reaproveitado silenciosamente para o projeto QA. Criar contas/fixture somente com autorização explícita e sem importar contas reais.
- Não adicionar segredo de conta de serviço no Worker QA para contornar Firestore Rules.

## Testes e implantação

`src/qa-user-firestore-bridge.test.js` cobre bloqueio de projeto e flags, token inválido, método/corpo indevido, consulta a um único documento, não vazamento de dados, autorização negada, erro de rede e tentativa de uso administrativo.

`wrangler.qa.toml` mantém:
```toml
GUARDIAN_V2_QA_FIRESTORE_BRIDGE = "false"
GUARDIAN_V2_QA_READER_PROJECT = "atrio-catolico-qa-v2"
```

**Não publicar a rota remotamente nesta etapa até que a suíte completa passe.** Um deploy QA posterior deverá preservar todas as flags de segurança, sem ativar essa rota.

## Próximo bloqueador real

Para o Guardião aplicar moderação permanente, é preciso uma identidade de servidor com permissões mínimas de leitura e escrita sobre **casos/avisos/quarentena**, sob custo gratuito e quotas conhecidas. O token de usuário não autoriza escrever dados administrativos, corretamente. O WIF atual do GitHub é **somente leitura**. Qualquer solução para execução contínua no projeto real exigirá desenho de identidade, execução de QA e autorização específica antes de liberar qualquer sanção.

## Limites preventivos de leitura na ponte QA (29/10/2026)

Implementação **somente na branch da PR #44**; o Worker remoto NÃO foi alterado nem habilitado.

- Dois bindings da Cloudflare Rate Limiting API devem existir para que a ponte efetue qualquer GET:
  `GUARDIAN_QA_GLOBAL_LIMITER` — limite nominal **20 leituras/minuto por local da Cloudflare**, mesma chave para todas as requisições QA.
  `GUARDIAN_QA_TOKEN_LIMITER` — limite nominal **3 leituras/minuto por token**, chave baseada em SHA-256 do token (nenhum JWT ou UID bruto é enviado ao limitador).
- A implementação recusa requisição com **429** quando um binding nega. Na ausência/falha de qualquer binding, retorna **503** sem consultar Firestore (fail-closed). Com a flag do Worker `false`, não consulta limitação nem banco.
- Os dois bindings estão descritos no `wrangler.qa.toml` isolado com namespaces distintos; confira colisões de namespace, suporte de plano e Wrangler **4.36+** antes de qualquer deploy.
- **Não é teto estrito**: a API Rate Limiting é *aproximada e local a cada data center*, podendo aceitar requisições adicionais. Não é suficiente para garantir cota gratuita global sob ataque. Para limite estrito, estudar Durable Objects e custo do plano **antes** de autorizar qualquer conexão remota.
- O token não é autenticado pelo limitador: somente o Firebase Firestore verifica assinatura e permissões na consulta. Rotação de tokens pode contornar limite por token, por isso existe também o limite agregado, igualmente aproximado.
- Não criar Auth QA remoto, não ativar a flag, não implantar Worker e não contratar recurso pago nesta etapa.

Documentação oficial: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Orçamento global persistente, com teto por dia UTC (preparado, NÃO implantado)

Além dos dois controles aproximados por minuto, a ponte experimental passa a exigir um **terceiro bloqueio independente**, `GUARDIAN_QA_BUDGET_DB`, uma base **D1 exclusiva de testes**. Uma única operação SQL `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE used < 12 RETURNING used` reserva **no máximo 12 tentativas de GET Firestore por data UTC** compartilhadas por todos os usuários, mesmo em localidades diferentes. O teto refere-se **somente a esta rota QA e a este banco D1 único**, não a todo o tráfego Firebase nem a futuras rotas.

- D1 ausente, tabela inexistente, SQL inválido, indisponibilidade ou erro de quota: resposta **503** sem GET Firebase.
- Orçamento de 12 já consumido: **429** sem GET Firebase. Tentativas gastam crédito mesmo quando a autenticação do Firebase falha ou o GET não retorna documento, pois não há devolução que introduza corrida.
- As limitações Cloudflare por local continuam antes da consulta D1, para proteger o próprio banco. A reserva atômica de escrita deve operar na base principal D1, sem leitura de réplica e **sem usar um contador de memória no Worker**.
- Migração SQL local em `cloudflare/guardian-worker/migrations/001_qa_budget.sql`. A suíte executa o mesmo SQL usando SQLite da biblioteca padrão Python, inclusive com múltiplas conexões concorrentes. A integração JavaScript usa mocks de D1; **não equivale a teste D1 real**.
- **Não foi criada nenhuma base D1** nem inserido `database_id` no `wrangler.qa.toml`: a flag `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false` continua desligada. Um binding real só poderá ser configurado quando for explicitamente autorizado, após conferir conta, cotas gratuitas e ID do banco isolado. Não usar a base do Átrio.
- Se vier a ser autorizado, será necessária uma entrada `[[d1_databases]]` com `binding = "GUARDIAN_QA_BUDGET_DB"`, `database_name` QA e `database_id` real do banco de testes, seguida da execução manual da migração **apenas no D1 QA**, e smoke completo com a rota ainda desligada.
- A documentação atual da Cloudflare informa que D1 está disponível no Workers Free, com quotas diárias que interrompem novas consultas quando atingidas; isso **não significa custo zero garantido em qualquer plano**. Não alterar plano ou habilitar faturamento. Um endpoint público continua sujeito a uso malicioso de D1/Workers mesmo que os GETs Firebase estejam limitados.
- Tokens Firebase QA reais e permissões de Security Rules ainda não foram testados remotamente. Nenhuma punição, scanner autônomo nem acesso ao banco oficial foi habilitado.

Referências Cloudflare:
https://developers.cloudflare.com/d1/worker-api/prepared-statements/
https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

## Banco D1 QA efetivamente provisionado, sem ativação de Worker

Em 29/10/2026, a conexão Cloudflare existente foi consultada e demonstrou somente dois bancos anteriores (`atrio-avatar-control`, `atrio-push-delivery`) — nenhum deles foi modificado. Foi criado um **terceiro banco D1 exclusivo**, sem ativar plano pago:
`atrio-guardian-v2-qa-budget`, ID `5ba3bbe6-e319-4c25-b958-6b53e940fb34`. A migração `001_qa_budget.sql` foi aplicada **somente nesse banco**, e a verificação de `sqlite_master` confirmou a tabela `guardian_qa_daily_budget` vazia.

O SQL exato da reserva diária foi exercitado diretamente pela API D1 usando a data sintética `2099-12-31`: 12 reservas retornaram `used=1..12`, a 13ª retornou lista vazia e o banco registrou 12. O registro sintético foi excluído do QA ao encerrar o ensaio. Não houve consulta Firebase neste ensaio remoto.

O `wrangler.qa.toml` agora contém o **ID exato do D1 de testes e seu binding planejado**, mais os dois rate limits locais. Um validador offline `scripts/check-qa-release-preflight.py` bloqueia CI se o Worker perder suas flags de segurança, os limites divergem, ou o D1 não for o exclusivamente criado.

**Atenção:** editar o Wrangler no GitHub NÃO instala os bindings no Worker já publicado. O Worker QA remoto continua com `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_TEST_MODE=true` e **sem flag de ponte ligada**. Nada foi implantado agora. O Firestore QA não foi acessado no ensaio D1. Antes de um futuro deploy, confirmar variáveis existentes na Cloudflare, validar compatibilidade do Wrangler, verificar custo/plano, preservar todos os desligamentos e fazer inspeção após o deploy. Não permitir moderação real com o usuário fictício.

**Checklist final de autorização futura:** (1) habilitar e conferir Auth/Firestore do projeto QA com fixture falsa e regras restritas; (2) implantar somente Worker `atrio-guardian-v2-qa` mantendo `QA_FIRESTORE_BRIDGE=false`; (3) testar health, rotas administrativas bloqueadas, rate limits e banco D1; (4) solicitar autorização separada antes de qualquer leitura Firebase remota por um cliente autenticado; (5) nunca migrar diretamente esta identidade QA para moderação real.


## Etapa 1 — Worker Cloudflare QA implantado (29/10/2026)

- Código da PR #44 (`1b80eba690a7a853ddd0ddeaca2752c6fd1b517d`) publicado **apenas** na instância de laboratório `atrio-guardian-v2-qa`, versão Cloudflare `87b9ece3-cb01-4866-ba2c-3cc493f92440` (número 8) por meio da API de versões e deployments. Nenhuma outra instância Cloudflare foi modificada.
- Implantação anterior preservada, versão `be038842-5f7a-40f8-ab2e-d01300043d69`, para reversão caso necessária. A versão 8 recebe 100% do tráfego **exclusivamente desse endereço QA**.
- Pós-implantação confirmada pela API da Cloudflare: `GUARDIAN_V2_TEST_MODE=true`, `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false`, `GUARDIAN_V2_QA_SHADOW_READS=false` e `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false`. Sem chave de conta de serviço, sem ID de backend Firebase, sem permissão para moderação.
- Bindings carregados e conferidos: D1 `GUARDIAN_QA_BUDGET_DB` usa **exclusivamente** o banco `atrio-guardian-v2-qa-budget`; limitadores QA global 20/min/local e por token 3/min/local. A tabela `guardian_qa_daily_budget` foi consultada e estava **vazia**, sem leituras Firebase.
- Adicionado `.github/workflows/guardiao-qa-remote-smoke.yml`: teste HTTP remoto rápido, sem secrets ou deploy, deve comprovar health 200, rota admin 503 e ponte Firebase 503. Não confundir versão implantada e smoke HTTP: registrar seu resultado separadamente.
- Se algum teste falhar: manter a flag da ponte desligada e suspender qualquer ativação. Para voltar à versão anterior, usar API Cloudflare Deployments com `be038842-5f7a-40f8-ab2e-d01300043d69` a 100%, mediante revisão da configuração. **Não reverter via alteração de Worker de notificações ou do Firebase oficial.**
- A etapa 2 requer um projeto Firebase QA realmente existente, regras isoladas, conta fictícia Auth QA, documento `posts/qa_post_1` e validação dos limites; **não habilitar** a ponte Firebase antes de tudo isso.
