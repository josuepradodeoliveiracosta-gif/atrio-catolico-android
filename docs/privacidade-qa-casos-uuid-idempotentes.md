# Átrio Católico — registro administrativo de casos em QA

O módulo qa-request-case-registry.mjs cria um UUID v4 por solicitação
fictícia em SQLite descartável. Tentativas idempotentes preservam o UUID.
Uma nova solicitação do mesmo UID exige revogar explicitamente o caso
anterior. Há duas decisões independentes, com identidade de revisor
fictícia, persistidas em SQLite sob transações BEGIN IMMEDIATE.

O caso é invalidado após revogação ou expiração. Qualquer divergência no
UUID, origem ou instante da solicitação impede reutilização de aprovação.
O método de autorização devolve productionReady:false,
approvedByRealAdministrators:false e canDeleteProductionAccount:false.

A bateria offline de testes inclui reinício, duplicidade de chamada,
dupla revisão, mudança de solicitação, revogação, vencimento,
credenciais de produção presentes e tentativa de usar UID não fictício.

IMPORTANTE: este primeiro registro UUID QA AINDA NAO está ligado ao
QaAdministrativeDeletionExecutor existente, tampouco a endpoint,
Firebase de produção ou Workers. Os revisores não são autenticados.
A integração de produção requer emissão por servidor real, IAM, auditoria
irrevogável, retenção juridicamente revisada, lease distribuído e prova
de exclusão independente. Nenhum deploy nem exclusão real foi feito.
A distribuição Google Play permanece bloqueada.
