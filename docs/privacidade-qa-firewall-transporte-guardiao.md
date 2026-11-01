# Privacidade — firewall de transporte Firestore do Guardião (QA, sem produção)

Esta etapa continua a PR #98, preserva a issue #72 aberta e não altera a `main`.

## Motivação

A camada de testes antiga envolve `processDocument` ou `db.commit` por um adaptador antes da gravação. Chamadas diretas ao `Firestore` original ficavam fora daquela barreira. **Não é seguro declarar os Workers atuais protegidos.**

## Exercício de integração implementado

`cloudflare/account-deletion-audit/src/qa-guardian-transport-firewall.js` intercepta somente no processo de teste o `fetch` emitido pelo `Firestore` REAL do Guardião. O código original do Worker **não é modificado**. O firewall exige URL exata do projeto usada no teste, cabeçalho sintético, operações conhecidas, lotes limitados e documento pertencente a uma das duas identidades fictícias. Sem rota de rede permitida.

O `POST :commit` passa pelo validador QA já existente `createQaGuardianCommitGate`, que confere proprietário, caso, auditoria, avisos e atores; adquire um ticket atômico na barreira SQLite fictícia antes do efeito simulado e exige reconciliação para retirá-lo. Qualquer erro ou verificação inconclusiva mantém o ticket.

`qa-guardian-transport-firewall.test.js` testa:

1. `processDocument(realFirestore,...)` — função real, cliente Firestore original — bloqueado para Alice congelada e aceito somente para Bob ativo no transporte simulado.
2. Chamada direta `realFirestore.commit` também precisa da barreira.
3. Fuga para URL externa, recursos desconhecidos e cabeçalho ausente são recusados.
4. Falha ambígua e verificação insuficiente mantêm o ticket aberto e bloqueiam `finalizeFreeze`.
5. Operação em andamento impede encerrar a conta até terminar e ser verificada.
6. A declaração de prontidão permanece `productionIntegrated:false`.

## Limites críticos

- Os testes substituem `globalThis.fetch` temporariamente e usam apenas respostas em memória e SQLite descartável. **Não há Firebase remoto, Worker implantado, IAM ou usuário real.**
- O firewall não é importado pelos Workers ativos nem controla as chamadas de Avatar, Push, FCM ou D1; também não assegura versão implantada, cron antigo, serviço Admin ou coerência distribuída.
- A verificação de efeito é injetada pelos testes; não comprova reconciliação de uma escrita real.
- Para produção é obrigatório implementar a barreira durável nos próprios serviços, com controle de ingresso, eliminação de bypass, IAM mínimo, retenção e testes de implantação em ambiente isolado.
- Não executar nem autorizar exclusão real, deploy, merge, AAB Play, alteração de assinatura ou backup por resultado deste ensaio.

CI: workflow `privacy-account-portal-ci.yml` já executa todos os arquivos `cloudflare/account-deletion-audit/src/*.test.js`, incluindo o novo ensaio.
