# Átrio Católico — inventário verificável de rotas privilegiadas (QA)

**Não é homologação de produção nem autorização de Play.** Contrato estático
em `cloudflare/account-deletion-audit/src/qa-worker-coverage-contract.js`.
A suíte da CI AAB já existente executa `npm --prefix
cloudflare/account-deletion-audit test`, incluindo o novo contrato.

- Quatro arquivos-fonte críticos possuem SHA de **Git blob** e marcadores
  de rotas, helpers e efeitos externos. Se um deles mudar, a CI exige
  revisão de segurança explícita e atualização consciente do hash.
- Há **15 entradas mutantes** mapeadas para categorias e escopos de contas,
  cobrindo Avatar, Guardião e Push. Cada entrada permanece marcada
  `not_integrated`, porque nenhum protocolo durável de produção foi conectado.
- Dez lacunas adicionais incluem writes de D1, rollback Cloudinary,
  FCM com resposta ambígua, cron, fila, broadcast e versões implantadas
  anteriores que não compartilham fencing.
- O contrato também bloqueia regressão para envio de respostas em tópico FCM
  e para desativação por variável do filtro bilateral.
- Não realiza rede, não cria serviços, não edita banco, não apaga contas e
  não executa deploy. Os SHA-1 indicam **integridade Git do código-fonte**,
  não autenticação do runtime implantado.

**Critério de saída:** cada caminho de escrita ativo deve ingressar em
coordenação persistente compartilhada com todas as contas afetadas, drenar
operações em trânsito e resistir a timeout, retry e erros ambíguos.
Só então poderão ser validados `worker_freeze` e `deletion_executor`
por evidências externas verificáveis. `releaseAuthorized:false`.


## Pré-verificação do freeze no Avatar (PR #71)

O Worker Avatar possui agora o helper read-only
`avatarDeletionFrozen(token,uid)`, que consulta
`account_deletion_freeze/{uid}` via Firestore REST com o token de serviço
do Worker. HTTP **404** é interpretado como ausência de congelamento;
HTTP **200** como marcador presente; qualquer outro status falha fechado.
Os testes locais usam chamadas HTTP simuladas e verificam IDs forjados.

`withAvatarLock()` confere o marcador **antes de inserir mutex no D1**
e novamente após adquirir a trava, antes de alterações Cloudinary ou
Firestore. A moderação que altera imagens também exige que o moderador
não esteja congelado; a trava do destinatário continua obrigatória.

**Limite crítico:** duas leituras antes do efeito não garantem que
uma exclusão não seja iniciada durante o efeito. Falta token de admissão
atômico, drenagem de operações, lease persistente e coordenação
compartilhada com os demais Workers. O código não foi implantado;
o bloco `worker_freeze` permanece não homologado.


## Guardião — pré-verificação de contas congeladas (01/11/2026)

O Guardião V2 agora consulta `account_deletion_freeze/{uid}` antes
 de escrever casos e avisos automáticos, antes de decisões de revisão
 administrativa e antes de alterar sua configuração por administrador.
 Quando um titular estiver congelado, a varredura registra o estado
 `frozen` sem gerar novos avisos. Se a consulta falhar, a operação
 não deve prosseguir (fail-closed). Há testes unitários isolados.

Esta verificação é **preventiva, não atômica**. Não implementa coordenação
 com ações já admitidas, Cloudinary, Push, D1 ou jobs legados. Não habilita
 moderação ou exclusão real; só constitui preparação para homologação.


## 01/11/2026 — transação para precondições do Guardião

**Falha descoberta:** a API REST Firestore v1 não define uma operação
`verify` no tipo `Write`. O código antigo enviava verificações como se
fossem writes REST normais. O adaptador passou a converter essas operações
em leituras dentro de uma transação real (`:beginTransaction`, GET com
`transaction`, `:commit` com o mesmo token, rollback best-effort).
A leitura do marcador ausente e a escrita tornam-se parte da mesma
transação serializável, impedindo que uma criação concorrente do
`account_deletion_freeze/{uid}` passe despercebida no commit.

O Guardião adiciona verificações atômicas de **ausência de marcador**
para titular e, quando aplicável, revisor/moderador, nos commits
de casos, auditoria, avisos, restauração, resolução e configuração.
As verificações antigas da revisão exata de post continuam sendo
transacionais. Testes unitários simulam precondition mismatch,
HTTP indisponível, transação abortada, sucesso e rollback.

**Ainda não homologado em produção:** workers não implantados, concorrência
entre FCM/Cloudinary/D1 fora do Firestore, executor de exclusão, identidade
curta, rollback, política de retenção e serviço HTTPS. A criação do
marcador administrativo real e o seu ciclo de vida precisam ser
homologados. Não interpretar testes unitários como E2E em serviço ativo.


## Push/Guardião — prevenção adicional de escrita por conta congelada (01/11/2026)

O Worker Push contém o helper `pushAccountFrozen(token,uid)`, consulta
de leitura via OAuth à coleção `account_deletion_freeze/{uid}`. HTTP 404
significa ausência, HTTP 200 significa congelamento, e erros 401/403/5xx
interrompem a operação (fail-closed).

A nova verificação alcança: autor da denúncia automática; titular na
quarentena; administrador e titular em `/moderation/review`; e fundador
em `/broadcast` antes de consumir cooldown D1. Testes simulam congelamento
e erro 503 sem criar relatório, alterar postagem ou enviar FCM.

**Não declarar fencing distribuído concluído:** o preflight não é atômico
com os efeitos posteriores. Notificações via tópico broadcast continuam
sem supressão individual de destinatários congelados. Outros writes de
Push, filas QA, token cleanup e operações em trânsito seguem pendentes.
Esta revisão não executou deploy, excluiu contas ou autorizou publicação.


### 01/11/2026 — Push administrativo e destinatários em exclusão

A triagem do Guardião mantém o registro da denúncia mesmo que um
administrador esteja congelado ou que a consulta de seu marcador falhe.
O envio FCM administrativo é suprimido antes da lista de dispositivos.
Dois cenários de QA verificam esse comportamento; um terceiro verifica
que o fundador congelado não consome o cooldown D1 de broadcast.

Continuam **fora da homologação** a entrega por tópicos FCM (sem filtro
individual de inscritos), as filas e eventos já em trânsito e a coordenação
persistente com Cloudinary/D1. São verificações preventivas, não fencing
atômico em produção. Nenhum deploy foi realizado.
