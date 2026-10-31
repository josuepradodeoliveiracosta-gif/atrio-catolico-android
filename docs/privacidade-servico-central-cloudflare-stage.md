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
