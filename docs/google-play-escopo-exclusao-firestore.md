# Contrato de escopo de exclusão — Firestore Rules e inventário

Este é um **alarme estático de cobertura**, não uma declaração de que
as contas podem ser excluídas em produção.

A nova suíte `cloudflare/account-deletion-audit/src/qa-firestore-schema-contract.test.js`
compara a lista ordenada de todos os blocos `match` do
`firestore.rules` com o contrato revisado. Uma nova coleção, subcoleção,
renomeação ou remoção causa falha na CI até que sua classificação de
privacidade seja atualizada.

As categorias distinguem perfis do titular, dados em coleções aninhadas,
referências relacionais, avisos de outros usuários, registros de moderação,
configuração sistêmica, marcadores administrativos e recibos de exclusão.

**Lacunas que continuam abertas:** `account_deletion_freeze`,
`account_deletion_requests`, `guardian_runtime`, referência ao fundador,
coleções órfãs e relações sem UID indexado; além de Cloudinary, FCM,
Firebase Auth e D1. Nenhuma dessas áreas recebeu autorização de exclusão
automática. `deletion_executor`, `worker_freeze` e `releaseAuthorized`
continuam não homologados.

O contrato é lido pela CI atual do `account-deletion-audit` (Node test)
e não executa consultas nem alterações na produção. Uma mudança nas regras
**exige revisão humana de privacidade**, não somente atualizar uma lista
para fazer a CI ficar verde.
