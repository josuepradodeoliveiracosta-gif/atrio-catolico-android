# Cloudflare QA — auditoria atual do bootstrap e travas do Worker

**Read-only.** Nenhuma mudança de Cloudflare foi realizada.

Em 10/11/2026, uma consulta à API da conta Cloudflare conectada
confirmou a existência de `atrio-qa-geral`, a variável do projeto QA,
o marcador de bootstrap, as quatro flags de envio/controle desligadas
e o binding `PUSH_DB` ao D1 `atrio-qa-geral-db` com UUID já versionado.
Outra consulta GET confirmou: `workers.dev` desativado, previews
desativados e zero agendamentos/cron do Worker QA. A consulta GET do
D1 confirmou seu nome e UUID. **Não foram consultadas linhas D1**
nem verificado o código remoto do Worker ou a versão implantada.

A captura sanitizada em `CLOUDFLARE-QA-CAPTURA-20261110.json`
**não é prova renovável** nem substitui uma nova leitura remota
autenticada no dia do deploy. Não inclui ID de conta, token,
metadados de clientes, segredos ou linhas do D1.

## Proteção de regressão

`scripts/qa_cloudflare_bootstrap_preflight.mjs` faz comparação
literal estrita do `wrangler.toml` versionado com a captura:
nome Worker e projeto Firebase, binding D1 e UUID,
`workers_dev=false`, `preview_urls=false`, `PUSH_ENABLED=false`,
broadcast/Guardião/manual desligados e modo bootstrap ativo.
Rejeita TOML com seções extras, flags habilitadas, banco oficial,
secrets adicionados ou duplicação de variável.

**Limites:** a CI usa apenas arquivos Git e a captura histórica;
não consulta a conta Cloudflare, não prova conteúdo/identidade real
das linhas D1, não autentica Worker remoto, não testa notificações
nem faz deploy. CI verde garante apenas o contrato local.

Antes do marco 4, comparar novamente conta, Worker remoto,
código implantado, D1, domínio/rotas, IAM, custos, segredos QA,
exposição pública e rollback real, com autorização específica.
Nunca ativar push/FCM, eventos ou edição do Worker oficial a
partir deste preflight; a issue #200 ainda bloqueia a operação.

**QA 2/7 (29%); marco 3 NO-GO.**
