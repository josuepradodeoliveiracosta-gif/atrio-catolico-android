> **RESULTADO REMOTO CONFIRMADO — 31/10/2026:** o ensaio de cinco Service Bindings retornou `passed` e foi persistido em `qa_stage_smoke_runs` no D1 de QA. Foram observados **zero tickets em aberto**, Alice/Bob `active`, e o cron temporário foi **removido** com leitura posterior confirmando lista de agendamentos vazia. O Worker de smoke permanece privado, com `workers.dev=false` e `previews_enabled=false`. Esta evidência só valida fixtures de QA, não a exclusão de contas reais.

# Átrio Católico — Stage Cloudflare privado, HMAC e consumidores

**Data da implantação:** 31/10/2026. **PR #98 (rascunho).**
**Escopo:** exclusivamente `qa-freeze-alice`, `qa-freeze-bob`; nenhuma conta real.
**Controle de publicação:** nenhum dado real, Firebase, Cloudinary, FCM ou Worker oficial foi conectado.

## Infraestrutura de QA realmente configurada na Cloudflare

O Worker central `atrio-privacy-freeze-qa-internal` utiliza o banco D1 dedicado `atrio-privacy-freeze-stage-fixtures`.

Cinco Workers **novos** foram criados, versionados e implantados, um por papel:
`atrio-privacy-qa-client-avatar`, `atrio-privacy-qa-client-guardian`,
`atrio-privacy-qa-client-push`, `atrio-privacy-qa-client-admin`,
`atrio-privacy-qa-client-reconciler`.

Cada consumidor tem o próprio Service Binding `PRIVACY_FREEZE_STAGE` para o Worker central e um segredo `ATRIO_QA_CONSUMER_HMAC` que corresponde **somente** ao segredo do seu papel no serviço central (`STAGE_*_HMAC`). São cinco chaves independentes de 48 bytes criptograficamente aleatórios, geradas no contexto privado da ferramenta, armazenadas **somente** por API de segredos e **nunca** impressas, copiadas para o GitHub ou incluídas em dados de teste.

A alteração de versão dos consumidores foi acompanhada de rotação coordenada dos cinco pares de segredos. A API Cloudflare confirmou os seis processos de stage com `workers.dev=false`, `previews_enabled=false`, pelo menos uma implantação e bindings de serviço adequados. Os nomes dos segredos foram confirmados; seus valores não foram consultados.

## Testes

- Testes offline no GitHub exercitam o Worker de stage original, HMAC, nonce, D1 em SQLite local, exclusão de pedidos inválidos, congelamento de autor+destinatário e reconciliação fictícia.
- A suíte `qa-stage-one-shot-smoke.test.js` também exercita os **cinco papéis** do consumidor privado, o Worker central, a prevenção de rede pública e a persistência de falhas.
- Um Worker adicional `atrio-privacy-qa-smoke-internal` foi criado **sem rota HTTP pública**, ligado aos cinco consumidores e ao D1 de QA. O seu `scheduled()` executa uma única admissão de Avatar, Guardião e Push, verifica status, solicita reconciliação sintética ao papel independente e verifica que não restam operações pendentes.
- O D1 contém a tabela `qa_stage_smoke_runs` com chave de execução fixa e INSERT OR IGNORE. Uma segunda invocação não repete efeitos. Se houver falha ou ambiguidade, registra `failed` e **não reconcilia automaticamente** qualquer ticket pendente.
- Um cron temporário `* * * * *` foi adicionado só ao Worker de smoke. **A execução remota de ponta a ponta não deve ser declarada aprovada até observar `passed` no banco D1 e remover o cron.** Cloudflare informa que o trigger pode levar até 15 minutos para propagar; não confundir agendamento salvo com execução comprovada.

## Limites

1. Isolamento é por recursos **na mesma conta Cloudflare**, não por conta independente.
2. Nenhum dos Workers ativos do Átrio foi modificado ou recebeu binding de QA. Os cinco consumidores só aceitam IDs fixos fictícios.
3. O papel `reconciler` confirma uma string de fixture sintética, não valida uma mensagem FCM ou exclusão Cloudinary/Firebase real.
4. Não há protocolo de retenção jurídica, executor de exclusão real homologado ou política pública HTTPS validada.
5. A migração original do D1 de fixture foi aplicada **somente** ao novo banco de testes; nenhuma base anterior foi alterada.
6. Após o smoke, deve-se **remover o Cron Trigger** e guardar o registro final de zero tickets, contas fictícias ativas e estado do job.

**Gate Google Play:** todos os nove requisitos do manifesto de privacidade permanecem `verified:false`; `releaseAuthorized:false`. Nenhum AAB ou release foi enviado à Play Store.
