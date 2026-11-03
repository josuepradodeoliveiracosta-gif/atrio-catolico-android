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


## IDs determinísticos são dados pessoais (reconciliação, 03/11/2026)

A auditoria independente `qa-deletion-reconciliation.mjs` agora
reconhece referências ao UID **dentro dos IDs de documentos**, mesmo
quando um registro deixa de conter `reporterUid` ou `targetUid`:
`reports/{reporterUid}_post_*`,
`reports/{reporterUid}_reply_*`,
`user_reports/{reporterUid}_user_{targetUid}` e
`posts/*/replies/*/reactions/{uid}`. A varredura do Firebase Emulator
é limitada a 2000 documentos por coleção/classe e **falha fechada**
quando esse limite é excedido ou os caminhos diferem do esquema.
Um único identificador remanescente impede remover até mesmo a
identidade Auth de teste. O teste existente `qa-deletion-emulator.test.mjs`
cobre documentos que não têm campo UID indexado; também confirma
que os documentos de moderação não são excluídos automaticamente.

**Decisão:** apagar `reporterUid` do conteúdo de uma denúncia não
constitui anonimização se o UID ainda aparece no próprio ID. O
procedimento real dependerá de revisão jurídica dos registros e de
mecanismo seguro para reidentificação/migração ou retenção fundamentada,
sem apagar arbitrariamente provas de denúncias nem publicações de
terceiros. Essa varredura integral limitada é só para base descartável:
a operação real requer inventário administrativo paginado em todas as
coleções e prova independente de ausência. Não habilita Play.


## Revogação de privilégios administrativos durante o congelamento (03/11/2026)

A função `isAdmin()` do `firestore.rules` agora exige
`accountWritable(request.auth.uid)` **antes** de conceder o papel
administrativo. O marcador de exclusão, criado exclusivamente por
serviço privilegiado, bloqueia também leitura de `reports` e
`user_reports`, decisões de moderação e exclusão de publicações
alheias através do cliente, mesmo quando `admins/{uid}.enabled`
permanece `true`. A regra preserva os acessos anteriores enquanto
não houver congelamento e os recupera quando o marcador é retirado por
operador autorizado.

A suíte existente `tests/security/account-deletion-freeze.test.mjs`
verifica a sequência **antes → congelado → descongelado** com uma conta
fictícia administradora, comprovando que a conta de outro membro e
suas publicações não são alteradas. Não foi necessário novo workflow.
Essa mudança é apenas nas Rules da PR; não implantamos as regras no
Firebase real. Workers Admin SDK contornam as Rules e ainda precisam
de proteção própria. Não autoriza execução real de exclusão ou Play.
