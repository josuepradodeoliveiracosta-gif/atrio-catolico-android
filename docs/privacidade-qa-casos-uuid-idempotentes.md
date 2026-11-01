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

## Integração fechada com o executor administrativo de QA

O registro UUID foi conectado **somente ao**
`QaAdministrativeDeletionExecutor` de `demo-atrio-v11`. O executor
cria um registro SQLite da **mesma base de checkpoints**, exige `caseId`
explicitamente fornecido pelo teste e chama `authorize` antes de entrar
no runner. O executor verifica de novo a aprovação do caso nas
transições de fase, após efeitos assíncronos, na retomada de checkpoints
e antes da remoção Auth fictícia.

`qa-deletion-request-binding.mjs` também mantém
`qa_deletion_case_binding`. Checkpoints nunca podem ser retomados por
outro `caseId`, mesmo que UID, origem e timestamp sejam iguais. Ao
substituir/revogar um caso depois de etapas parcialmente concluídas,
a execução é bloqueada; não há migração automática de checkpoints.
O runner genérico QA continua isolado para ensaios de limpeza sem
ordem administrativa, mas não pode retomar um journal vinculado a caso
sem apresentar o UUID.

Os testes de integração cobrem caso ausente, somente uma aprovação,
revogação durante uma etapa e tentativa de retomar outro UUID.
**Este vínculo continua restrito a SQLite/Firestore Emulator e
revisores fictícios**, não dá permissão de produção.
