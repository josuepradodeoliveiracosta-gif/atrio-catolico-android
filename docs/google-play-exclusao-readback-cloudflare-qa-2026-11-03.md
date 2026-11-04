# Átrio Católico — contrato privado de readback congelamento/drenagem (QA)

**03/11/2026. PR #71 em rascunho. Sem deploy, sem dados reais.**

## Mudança

O Worker privado de fixture agora devolve o **UID exato** na resposta de estado/congelamento e o **UID e caseId** em atestações de caso. O cliente HMAC recusa respostas do UID, caso, fase, ticket e checkpoint incorretos, mesmo que tragam status HTTP 200. Respostas de fechamento incluem o ticket correspondente.

O novo módulo `cloudflare/privacy-freeze-stage/src/qa-fence-readback.js` implementa somente `freeze.verify` e `freeze.drained` para **qa-freeze-alice / qa-freeze-bob**. Ele consulta o Worker privado via Service Binding autenticado, lê estado antes e depois da confirmação do caso no D1 e impede que estado desconhecido ou ticket pendente seja aceito como drenado.

## Prova automática

Testes executam handler Worker, autenticação HMAC e comandos SQLite análogos a D1. Cobrem: ticket anterior que impede congelamento, reconciliação independente, caso aberto somente após congelar, troca de UID ou caseId, perda de rede e injeção sintética de operação pendente depois da conclusão.

## Limites

O adaptador é **apenas de leitura**: não implementa `freeze.enable`, não executa exclusão e não integra o executor de Firebase Emulator (`qa-delete-*`) porque as contas de stage `qa-freeze-*` pertencem a **outro domínio de confiança**. Fazer um mapeamento de UIDs entre esses domínios seria inseguro. Em produção continuam faltando identidade, IAM, serialização de admissões, drenagem dos provedores externos e retenção revisada. `releaseAuthorized:false`; `main`, backups, Play Console e Workers publicados permanecem fora do escopo.
