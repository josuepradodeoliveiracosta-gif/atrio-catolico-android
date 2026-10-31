> **ATUALIZAÇÃO DE INFRAESTRUTURA — 31/10/2026:** foi criado um banco D1 novo de QA e implantado um Worker privado apenas para fixtures, SEM rota pública, sem segredos HMAC, sem Service Binding consumidor e sem dados reais. A conta Cloudflare permanece a mesma (isolamento de recursos, não de conta). Os trechos abaixo que descrevem "não implantado" representam o estado anterior. Registro do estado atual e das verificações remotas: [Homologação Cloudflare stage remota](privacidade-cloudflare-stage-remoto-2026-10-31.md). **A produção e a Google Play continuam bloqueadas.**

# Átrio Católico — serviço central de congelamento autenticado (Cloudflare STAGING ONLY)

**PR #98, 31/10/2026.** Este código é um protótipo real de Worker + cliente de **Service Binding HTTP** + consultas D1, mas **não foi implantado**, não acessa produção, não exclui conta e não concede aprovação Play Store.

## Arquivos

- `cloudflare/privacy-freeze-stage/src/index.js`: Worker central privado; recebe pedidos HMAC autenticados, valida papéis e escopos e mantém tickets no D1.
- `src/protocol.js`: assinatura SHA-256/HMAC, verificação de integridade, tempo e nonce único; inclui projeto `demo-atrio-v11` e ação no material assinado.
- `src/client.js`: cliente que usa **somente** `binding.fetch(request)`, não `fetch` global; nunca publica uma URL externa.
- `migrations/0001_fixture_only.sql`: cria banco do zero com CHECK restrito a `qa-freeze-alice` e `qa-freeze-bob` e ledger de nonces.
- `wrangler.staging.example.toml`: `workers_dev=false`, **sem rotas públicas**, placeholder deliberadamente inválido de database_id. Nenhum deploy automático.
- `qa-stage-service-binding.test.js`: testes HMAC/replay, autorização independente por papel, validação de escopo, tickets persistentes em SQLite com duas conexões, falhas e reconciliação.
- `qa-stage-real-workers-integration.test.js`: **as entradas originais de Avatar, Guardião e Push** chamam o mesmo Worker central usando Service Binding fictício; verifica emissão por serviço, congelamento conjunto, isolamento de contas, falha de resposta após admissão e ausência de rede pública.
- `cloudflare/privacy-shared-qa/src/worker-entry.js`: no modo de QA `ATRIO_PRIVACY_QA_SHARED_MODE=true`, suporta exatamente **um** dos coordenadores: SQLite local anterior **ou** Service Binding estágio. Misturar ambos é negado para impedir fallback. O adaptador autenticado exige `ATRIO_QA_PRIVACY_STAGE_BINDING` e `ATRIO_QA_PRIVACY_STAGE_SECRET`, fixture demo e *nenhum* binding ou segredo de produção. A entrada devolve apenas ticket de fixture para reconciliação independente.


## Protocolo de menor privilégio

Papéis distintos com **cinco segredos diferentes**, somente no gerenciador de segredos do estágio: `avatar`, `guardian`, `push`, `admin`, `reconciler`.

1. Worker autenticado com HMAC e nonce solicita `/v1/admit` com escopo fixo e sintético. O serviço persiste operações **antes** de o chamador iniciar um efeito externo.
2. Administrador independente solicita `/v1/drain`; ingressos novos para essa conta passam a ser negados.
3. `/v1/finalize` exige nenhuma operação pendente; se houve falha, reinício ou resultado incerto, é negado.
4. Somente o papel `reconciler` pode confirmar efeitos de **fixture** com `/v1/close`, fornecendo ID de operação e `fixtureEvidence:'demo-confirmed'`. Essa evidência não representa auditoria de efeito real.
5. `/v1/status` é leitura restrita ao administrador.

Todas as ações são `POST` com corpo curto, `x-atrio-role`, `x-atrio-time`, `x-atrio-nonce` e `x-atrio-signature`. A assinatura inclui projeto, papel, data, nonce, caminho e corpo integral. Janela de 60 segundos; replay é bloqueado por chave primária única no D1. Não se registra conteúdo de usuários ou senhas no código.

O banco contém **somente duas contas fictícias**, por restrição SQL. Nenhum serviço Firebase/Cloudinary/FCM é chamado. Os identificadores de contas reais são recusados inclusive se houver um segredo de homologação vazado.

## Antes de qualquer implantação SEGREGADA (ainda pendente)

- Criar um **novo** banco D1 exclusivamente para o estágio e aplicar a migração **apenas** nele. Verificar nome e ID manualmente; nunca usar D1 de Avatar/Push ou Firestore de produção.
- Solicitar revisão humana da configuração, escolher uma conta Cloudflare isolada e manter `workers_dev=false`, sem rotas, sem triggers, sem endpoints públicos.
- Inserir cinco segredos de alta entropia distintos, sem gravá-los no repositório. Configurar Service Bindings com permissões estritas de cada chamador ao Worker de stage.
- Testar com Wrangler em modo local e, após aprovação explícita, validar contra D1 segregado real e rotinas de concorrência/restart; verificar rollback e logs sanitizados.
- Revisar custo, limites e duração de nonces. O banco de testes atualmente não elimina registros de nonce; planejar rotina de expurgo com TTL seguro, sob revisão.
- Só então desenvolver IAM do ambiente definitivo, proteção **dos caminhos normais de escrita** (não das entradas de fixture) em Avatar/Guardião/Push, congelamento por UID real, fencing por geração, reconciliação confiável das saídas externas e revogação de versões antigas.

**Revisão crítica:** uma confirmação `fixtureEvidence:'demo-confirmed'` serve para teste de papel administrativo, mas **jamais** é evidência suficiente para liberar exclusão de conta real; será necessário mecanismo de reconciliação independente de efeitos reais.

O arquivo `wrangler.staging.example.toml` tem `database_id` propositalmente não executável. Não renomear, não implantar e não aplicar SQL sem autorização do proprietário.

## Status Google Play

- `productionIntegrated:false`.
- `safeToDeleteRealAccounts:false`.
- `publicDeletionPortalVerified:false`.
- Checklist das nove evidências da Play ainda bloqueado (`docs/google-play-privacidade-evidencias.json`).
- Issue #72 permanece aberta; PR #98 rascunho.
- Branch `main`, backups, assinatura e OTA mantidos intactos.

Referências Cloudflare: [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [D1 Prepared Statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/).


## Pré-homologação remota — execução bloqueada até autorização explícita

A inspeção de inventário do provedor deve ser **somente leitura**. Não inserir
identificadores de conta, nomes de bancos já existentes, segredos ou URLs
operacionais no repositório público. Na ausência de um ambiente segregado
comprovado, interromper a implantação: nenhum recurso existente pode ser
reutilizado, substituído, migrado ou reconfigurado.

**Condições para uma aprovação separada do proprietário:**

1. Definir onde será feito o estágio isolado (preferencialmente em conta
   separada); confirmar que não compartilha o banco de produção, serviços,
   segredos, rotas ou credenciais do Átrio.
2. Autorizar nominalmente a criação de **um banco D1 novo**, **um Worker
   interno novo** e segredos distintos, especificando se podem gerar custo.
   Nenhuma alteração em Worker existente está incluída nessa autorização.
3. Aplicar exclusivamente `0001_fixture_only.sql` ao banco recém-criado
   e confirmar que os dois `CHECK(uid IN (...))` continuam intactos.
4. Preservar `workers_dev=false`, nenhuma rota pública e nenhuma rota
   customizada. Os futuros consumidores devem ser outros Workers de stage,
   também isolados e com acesso exclusivamente via Service Binding.
5. Validar chamadas assinadas, papéis, nonces com conexões concorrentes,
   revogação/rotação de chaves e interrupção após gravação do marcador.
6. Exigir evidência de rollback e desligamento antes de acoplar qualquer
   mecanismo de contas ou dados reais.

**Proibido nesta fase:** rodar `wrangler deploy`, `d1 migrations apply
--remote`, criar credenciais de produção, alterar a branch `main`,
substituir IDs em configs ativas, habilitar os três Workers oficiais ou
executar exclusão de conta. A verificação `preflight.mjs --audit` é somente
leitura e é intencionalmente incapaz de conceder autorização de deploy.

### Ensaios de falha adicionais

A suíte `qa-stage-cloudflare-drill.test.js` testa cinco cenários offline:
dois pedidos concorrentes com o mesmo nonce, reutilização do nonce por outro
papel autorizado, rotação de chave HMAC, persistência de nonce de resultado
incerto e impossibilidade de o administrador reconciliar sozinho uma
operação pendente. Esses testes executam o Worker central original contra
SQLite fictício e nunca criam recursos de Cloudflare.
