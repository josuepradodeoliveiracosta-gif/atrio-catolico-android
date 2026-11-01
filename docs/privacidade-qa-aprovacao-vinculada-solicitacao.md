# Átrio Católico — revisão administrativa vinculada à solicitação (QA)

A ordem administrativa de duas aprovações agora especifica a origem e
data da solicitação no emulador, tanto na ordem quanto em cada parecer
fictício. Antes de admitir a execução, a camada administrativa relê
`account_deletion_requests/{uid}` no Firestore Emulator e exige
correspondência completa. Se o pedido mudar de origem ou instante,
os pareceres antigos não autorizam o novo processamento, mesmo com
a mesma conta e nenhum checkpoint gravado.

Testes verificam alteração da solicitação, aprovação individual
fora de prazo/vínculo e preservação de dados de outra conta.
Essa implementação **não identifica revisores reais**, não usa
assinaturas digitais nem executa exclusão em produção.

O serviço definitivo precisa de ID único de pedido criado por backend,
revisores autenticados e autorizados, decisões de retenção, controle de
revogação/expiração, ledger e bloqueios distribuídos com fencing em
Firestore, Firebase Auth, Cloudinary e Workers. Nenhum Firebase real foi
alterado; a PR #98 permanece draft e o gate Play permanece bloqueado.
