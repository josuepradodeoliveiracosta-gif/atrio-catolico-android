# Privacidade — drenagem de operações dos Workers antes da exclusão Auth (somente QA)

Implementado na **PR consolidada #98**, sem nova PR nem merge.

## Problema

O marcador `account_deletion_freeze/{uid}` no Firestore bloqueia
operações de clientes e dos escritores administrativos que usam o
adaptador de teste. Entretanto, existe um conjunto separado de
operações privilegiadas de Avatar, Guardião e Push que pode estar
em andamento. Excluir o Firebase Auth com essas operações pendentes
poderia deixar gravações e efeitos externos atrasados.

**Esses Workers de produção ainda NÃO usam a barreira.**

## Protocolo que foi testado

Um ledger SQLite *temporário*, armazenado em diretório descartável,
usa os **mesmos UIDs fictícios** `qa-delete-alice` e `qa-delete-bob`
que o Firestore e o Auth Emulator. Ele registra operações fictícias
`avatar_upload`, `guardian_commit` e `push_fanout`.

- `begin(uid, kind)`: admite uma operação somente quando a conta
  está `active`. A reserva e a leitura do estado são uma única
  instrução SQL.
- `seal(uid)`: move a conta Alice para `draining`, proibindo novas
  operações; só conclui `frozen` quando o ledger está vazio.
- `complete(ticket, {verify})`: exige verificação independente do
  efeito simulado para retirar o ticket. Falhas ou respostas
  ambíguas mantêm o ticket pendente.
- `verify(uid)`: exige `frozen` e zero operações pendentes,
  inclusive após nova conexão SQLite.
- O executor de exclusão exige `workers.seal()` antes da
  aquisição do marcador Firestore, e `workers.verify()`
  antes de apagar o Auth e durante a verificação final.
- O teste com o Firebase Admin SDK comprova bloqueio de exclusão
  sob operação fictícia pendente, retomada após reconciliação,
  preservação da conta Bob, adulteração do marcador rejeitada e
  persistência do ledger após reiniciar as conexões.

Os testes de `qa-worker-drain.test.mjs` exercitam tickets
forjados, UIDs não autorizados, efeito desconhecido, nova conexão,
ambiente não local e separação entre contas.

## Limites e bloqueios para a Play Store

**O ledger não é conectado a nenhum Worker real e não protege a
produção.** Ele representa um contrato de quiescência, não uma
garantia distribuída. Não transfere operações reais de FCM,
Cloudinary ou D1 para o SQLite, não fornece autenticação
administrativa real, não resolve jobs antigos nem altera
os scripts de implantação. A conclusão do teste nunca significa
que uma conta de produção pode ser apagada.

Para liberar a operação real será necessário garantir que **todos**
os Workers e versões implantadas usem uma coordenação durável
compartilhada, com controle IAM, fencing efetivo, inventário global,
reconciliação dos efeitos e regras de retenção homologadas.
O portal HTTPS e o processo legal de exclusão também permanecem
pendentes na **issue #72**.

O projeto `demo-atrio-v11` e os hosts locais de Auth/Firestore
são obrigatórios. A CI retira `FIREBASE_CONFIG` apenas dos
processos QA. Nenhum deploy, exclusão real ou atualização do
Android, backup, assinatura, OTA ou `main`.

`productionIntegrated=false`;
`allWorkersGuarded=false`;
`safeToDeleteRealAccounts=false`.
