# Átrio Católico — execução com ticket durável e efeito fictício (QA)

**03/11/2026 — PR #71 (rascunho) — Não homologado para produção.**

## Objetivo

A camada de QA já admite 15 caminhos por credencial de Avatar, Guardião e Push, usando HMAC, nonce único e SQLite compatível com D1. A presente etapa torna testável a **ordem obrigatória** para uma ação que alteraria dados: obter um ticket persistente *antes* do efeito; executar somente um efeito **fictício**; exigir leitura independente antes de encerrar o ticket.

## Implementação

`cloudflare/privacy-freeze-stage/src/qa-ticketed-fixture-effect.js` expõe duas funções que não são importadas pelos Workers implantados:

- `runQaTicketedFixtureEffect({client,role,route,scope,fixtureStore})` valida o escopo por papel e UID sintético; chama o coordenador de QA via `client.request('writeAdmit')`; exige confirmação `stage_admitted` e ID de operação válido antes de chamar `fixtureStore.applyFixture`. O adaptador é fornecido **exclusivamente pelos testes** e grava no banco local SQLite, com `operation_id` como chave única. Não há SDK de provedores, global fetch, upload, Cloudinary, FCM ou Firebase real.
- `reconcileQaTicketedFixtureEffect({reconciler,operationId,independentReadback})` usa outra identidade HMAC, pertencente ao papel `reconciler`, após uma leitura fresca de confirmação. Se a leitura falhar, retornar falso ou lançar erro, o ticket permanece registrado; `finalizeFreeze` continua bloqueado enquanto houver operação pendente.

**Não há fechamento automático de ticket, nem repetição automática após erro de rede ou resultado incerto.** Uma operação já aplicada e seguida de timeout deixa um marcador no SQLite e um ticket em trânsito até conciliação independente. O resultado bem-sucedido só declara `qa_fixture_effect_pending_reconciliation`, nunca `productionReady` ou `accountDeletionHomologated`.

A implementação aceita uma interface de efeito injetável exclusivamente de QA: **essa interface não é uma sandbox contra código arbitrário**. A segurança de produção exige mover a admissão para todas as bordas reais de escrita, aplicar o bloqueio no próprio backend e demonstrar IAM, isolamento de chaves e leitura independente de cada provedor.

## Testes e critérios

Sete testes foram acrescentados à suíte `cloudflare/account-deletion-audit/src/qa-stage-service-binding.test.js`, reutilizando o Worker.fetch real do módulo, protocolo HMAC e SQLite com arquivo persistente:

1. Avatar, Guardião e Push: três efeitos sintéticos permitidos apenas depois de ticket; fechamento por credencial reconciliadora.
2. Contas em drenagem: nenhuma ação sintética é executada sem admissão.
3. Efeito gravado mas resposta incerta: ticket continua pendente após reinício da conexão; congelamento não finaliza até readback e conciliação.
4. Falha antes de gravar: nenhum efeito é certificado e o ticket continua bloqueando o congelamento.
5. Leitura não confirmada e tentativa de reconciliação com credencial do papel errado: rejeitadas.
6. UID de usuário real, papel incompatível e binding indisponível: nenhuma ação fictícia ocorre.
7. Push de duas contas: ambos os titulares são protegidos por um mesmo ticket; destino em `draining` só é finalizado após conciliação.

É proibido usar dados de usuários verdadeiros, implantar esses módulos nos Workers produtivos ou interpretar aprovação dos testes como homologação de exclusão de contas.

## Pendências e controles

Os **15 caminhos de escrita reais continuam `not_integrated`** no contrato `qa-worker-coverage-contract.js`; os nomes QA não cobrem automaticamente efeitos externos. Faltam os adaptadores de produção com tickets D1/durable coordination, a segregação Firebase e Cloudinary remotos, prova FCM e retenção/legalidade LGPD e Play Store.

**Estado exigido:** PR #71 draft, `releaseAuthorized:false`, sem merge, sem deploy em produção, sem assinatura e sem exclusão de contas reais.
