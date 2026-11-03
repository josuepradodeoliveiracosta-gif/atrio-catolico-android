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


## Limpeza recursiva administrativa de subcoleções órfãs (QA, 03/11/2026)

Novo módulo `tests/security/admin-fixture/qa-admin-owned-descendant-purge.mjs`
executa **remoção real de documentos no Firestore Emulator local**, usando
Firebase Admin SDK e **somente o UID sintético** `qa-delete-alice`. Percorre
subcoleções de qualquer nome sob as raízes privadas do titular, inclusive
documentos netos com pais ausentes, aplicando limites explícitos de
profundidade e quantidade, validação estrita do caminho e exclusão dos filhos
antes dos pais. Inventaria a árvore inteira antes da primeira alteração.
Checa autorização administrativa de QA e fence a cada operação; nova leitura
verifica ausência e reexecução não repete efeitos. As raízes não são apagadas
pelo novo método, e dados de terceiros não entram no escopo.

A suíte E2E **existente** do Admin SDK passou a usar o método depois de
comprovar que o auditor independente bloqueou Auth diante de um neto órfão;
também preserva a árvore de Bob e testa repetição sem efeitos. O método
não é invocado em produção, não possui HTTP público, não remove Auth,
Cloudinary, D1, referências relacionais ou documentos de moderação.
O contrato permanece bloqueado para release até a aprovação de IAM,
retenção, processamento de terceiros e fence distribuído. Não publicar o
aplicativo por causa de uma prova do emulador.


## Referências cruzadas de notificações/bloqueios — QA isolado (03/11/2026)

O novo `qa-admin-foreign-reference-cleanup.mjs` remove, **apenas no
Firestore Emulator** e com revisão explícita da fixture, duas classes
estreitamente delimitadas: notificações automáticas cujo `actorUid`
pertence à conta sintética excluída e preferências `blockedMembers`
de terceiros cuja chave identifica exatamente aquela conta. A rotina
faz inventário completo limitado, confere a identidade/caminho e o
esquema da notificação, revisa a autorização e o fence de QA antes de
cada efeito, relê o registro e confirma ausência depois da operação.

No mesmo teste de Admin SDK, criar referências tardias agora bloqueia
a remoção de Auth; a limpeza remove apenas esses vínculos e preserva
notificações próprias do segundo usuário, outros bloqueios, sua árvore
privada, Auth e registros de moderação. Reexecução não repete exclusões.
A rotina **não** trata denúncias, histórico de Guardião, conteúdo
público, retenção, D1, imagens nem corrida entre serviços reais;
não é integrada ao backend de produção e não autoriza publicação.
