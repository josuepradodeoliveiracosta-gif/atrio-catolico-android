# Homologação remota Cloudflare — 31/10/2026

**Somente ambiente de fixtures, PR #98. Não é a produção e não autoriza Play Store.**

## Recursos NOVOS provisionados

- D1 novo: `atrio-privacy-freeze-stage-fixtures`. Não reutiliza os três bancos existentes.
- Worker novo: `atrio-privacy-freeze-qa-internal`. Não substitui nenhum dos quatro Workers anteriores.
- A operação foi feita dentro da conta Cloudflare já conectada. **Isolamento por recurso e nomes dedicados, NÃO por conta Cloudflare separada.** Revisar IAM da conta antes de conectar quaisquer dados reais.

## Procedimento realizado e comprovado por consultas do provedor

1. Inventário prévio: nenhum D1 ou Worker com os nomes reservados existia.
2. Criado banco D1 com replicação desabilitada, sem contato com bases anteriores.
3. Aplicado somente `cloudflare/privacy-freeze-stage/migrations/0001_fixture_only.sql` ao banco novo.
4. SQL remoto confirmou três tabelas `qa_*`, dois `CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob'))` e exatamente dois registros fictícios `active`.
5. Ensaio remoto: ingresso atômico Push de Alice+Bob, congelamento de Alice, tentativa negada de concluir com ticket aberto, tentativa negada de nova escrita durante `draining`, fechamento dos dois tickets e conclusão do freeze. **Todas as seis verificações foram coerentes com a especificação.**
6. Feita limpeza de fixtures após o ensaio. Consulta final: duas contas `active`, **zero operações pendentes e zero nonces**.
7. Inserção experimental com UID não pertencente à fixture foi recusada pelo D1 (`SQLITE_CONSTRAINT_CHECK`). Consulta posterior confirmou que somente Alice/Bob permaneciam.
8. Criado Worker novo e enviada a **versão 1 como versão não publicada**, com os três módulos JavaScript do repositório: `privacy-freeze-stage/src/index.js`, `protocol.js` e `qa-privileged-write-barrier.js`.
9. Desabilitados explicitamente `workers.dev` e as URLs de pré-visualização **antes** da implantação. Consultas de retorno: ambas `false`.
10. Implantada somente a versão 1 do Worker privado, sem novas rotas, sem cron, sem vincular o Worker aos consumidores ativos. Conferência final: 1 versão, 1 implantação, nenhuma rota pública criada durante esta operação.
11. Bindings da versão implantada: somente `ATRIO_PRIVACY_STAGE_ID=demo-atrio-v11` e `STAGE_FREEZE_DB` apontando para o **novo** D1. **Nenhum segredo HMAC foi configurado e nenhum Worker consumidor recebeu um Service Binding**. Portanto o serviço deve recusar qualquer chamada: a proteção `keysReady` falha sem cinco segredos válidos/distintos.

**Segurança:** nenhuma exclusão de conta real, migração em banco existente, alteração de `main`, dos Workers existentes, backup, assinatura Android, OTA ou publicação Play Console.

## Evidências técnicas e limites

Evidências observadas por consultas Cloudflare read-only após as escritas: banco dedicado com as duas contas e nenhum ticket; Worker privado implantado; acesso `workers.dev=false` e `previews_enabled=false`.

O teste SQL remoto **não** equivale a chamada HTTP assinada ao Worker implantado: essa parte ainda não foi exercitada contra a rede Cloudflare. O Worker não usa Firebase, Auth real, Cloudinary ou FCM. Ainda não há IAM de ambiente separado, fluxo de recuperação administrativo real nem execução completa de exclusão.

Como o módulo no GitHub continua com `wrangler.staging.example.toml` propositalmente não executável, não salvar um arquivo `wrangler.toml` operacional no repositório público com IDs reais. A versão 1 da Cloudflare é um alvo privado e específico para futura homologação.

## Próximas validações antes de autorizar ligação à produção

1. Revisar isolamento administrativo da conta e permissões da Cloudflare. Se necessário, transferir o estágio para outra conta — **sem copiar dados de produção**.
2. Criar credenciais HMAC distintas com gerador criptográfico e armazenar exclusivamente nos segredos dos Workers de stage; compartilhar somente por bindings apropriados com consumidores **novos e segregados**, nunca com Workers ativos neste momento.
3. Implantar um consumidor de teste sem rota pública e homologar assinatura, nonce, replays, concorrência, rotação e falha parcial por Service Binding.
4. Obter evidência de observabilidade e rollback privado e garantir que todos os processos fiquem isolados do usuário real.
5. Apenas após revisão independente, desenvolver a cobertura de caminhos de gravação reais, operação administrativa auditada e reconciliação de efeitos de serviços externos.
6. Concluir política pública HTTPS, retenção, exclusão ponta a ponta, AAB assinado e campos Play Console.

**Todos os nove requisitos** de `docs/google-play-privacidade-evidencias.json` continuam `verified:false`; `releaseAuthorized:false`. A issue #72 segue aberta. PR #98 permanece rascunho.
