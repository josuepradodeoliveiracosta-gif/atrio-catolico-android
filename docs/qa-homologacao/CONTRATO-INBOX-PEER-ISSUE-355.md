# Contrato de caixa de entrada por contato — Issue #355
**Escopo:** proposta de Firestore Rules + materializador de servidor, somente candidato QA.
**Base:** main@74358dcb (PR #350 integrada). **Dependência funcional:** PR #352 para revogação de GET de conversa e histórico. Sem deploy.

## Motivo da troca
A consulta antiga `collection('chats').where('participants','array-contains',uid)` retorna metadados de chats bloqueados: o Firestore não consegue provar `chatNoBlock(resource.data.requesterUid,...)` para uma consulta global. A nova Rules-base **nega toda `list` de `chats`**, inclusive se o cliente manipular filtros.

## Contrato para o Chat 3
- **GET/consulta por contato conhecido (não global):**
  `users/{ownerUid}/chatInboxByPeer/{peerUid}/entries/{chatId}`.
  `chatId` deve ser o ID determinístico da conversa, `ownerUid__peerUid` ou `peerUid__ownerUid` conforme os participantes.
- **Consulta**: `collection("users/{ownerUid}/chatInboxByPeer/{peerUid}/entries").limit(20)`; não consultar `collection("chats")` nem fazer `collectionGroup("entries")`. Somente o titular do caminho com Auth válida e par não bloqueado acessa os resultados; consulta sem limit é negada.
- **Modelo materializado pelo servidor:** `{ownerUid, peerUid, chatId, status, lastPreview, updatedAt}` — estritamente os campos necessários. Nenhum dispositivo pode escrever essa visão, inclusive o titular.
- **Fonte autorizadora**: Security Rules consultam os DOIS documentos `users/{a}/blockedMembers/{b}` e `users/{b}/blockedMembers/{a}` usando os UIDs do caminho; não dependem de campo filtrável, flag de UI ou do materializador ter apagado a visão.
- **Visão não descoberta automaticamente:** este contrato **não fornece um endpoint para descobrir todos os peerUid**. A UI só consegue consultar pares que já conhece por uma fonte autorizada. Para a caixa completa será necessário mecanismo de descoberta no servidor com autorização equivalente e migração de UX, evitando publicar uma lista geral de UIDs, IDs ou contagens de conversas bloqueadas. **Não lançar o novo contrato enquanto isso não existir.** Chat 3 deve resolver UX/inbox/arquivados com Chat 2.
- **Leitura da conversa e histórico:** depende da #352; esta PR **não** duplica suas modificações nem a autoriza. Até integrar #352, GET de `chats/{chatId}` na main continua limitado apenas por participação (risco separado). Ambas são necessárias antes de declarar a #355 encerrada.

## Escrita / consistência
`firebase/qa-general/chat-inbox-peer-index.mjs` exporta `peerInboxEntries` (validação estrita de par e dados) e `reconcilePeerInbox` (exige **Admin SDK confiável** e lê chat + dois bloqueios dentro da transação antes de escrever/excluir ambas as visões). **NÃO é gatilho instalado**, não executa sozinho nem concede IAM/credenciais.

O integrador de backend deverá invocar a reconciliação no fluxo de criação, nova mensagem, edição, revogação, bloqueio, desbloqueio e remoção da conversa; preparar migração/backfill de conversas existentes sem importar dados reais no repositório. As Rules protegem imediatamente o par bloqueado **mesmo que a visão não seja apagada**, permitindo bloqueios simultâneos sem janela de listagem após a confirmação do commit. Desbloqueio pode reabrir um índice stale até atualização; documentar cadência e consistência dos metadados. Uma consulta já concluída **antes** do commit de bloqueio não pode ser desfeita.

## Cache, reconexão, segurança e escala
- Firestore Rules se aplicam a **requisições ao servidor**. Não apagam documentos já persistidos no cache offline de um aparelho: para dados de inbox, Chat 3 deve exigir `Source.SERVER` / `getDocsFromServer` nas transições de bloqueio, descartar estado visível e rever política de persistência. Testes de Emulator exercitam acesso no servidor, não afirmam expurgo físico do cache.
- Leitura peer-scoped exige ~2 verificações `exists()` de bloqueio + gates de Auth/idade/config por consulta. Há uma query por contato conhecido, de até 20 entradas, e duas visões escritas por atualização. Limites e latência em celulares exigem comparação com API autenticada agregadora no servidor **antes de escalar**.
- A lista geral de `chatBox` e dados locais de arquivamento e silenciamento não é um índice confiável de conversas; não pode ser usada como bypass de visibilidade ou descoberta pública.
- O Admin SDK ignora Security Rules; conceder escrita apenas a identidade de serviço de QA explicitamente revisada. O materializador sempre valida os pares, nunca aceita UID arbitrário de requisição cliente.
- Testar corrida de dois bloqueios, falso usuário, email não verificado, sessão nova, sem índice, índices stale e ambos os sentidos. O Firebase Emulator é o único destino dos testes desta PR. Sem evidência de reativação Firebase remoto.

## Estado de entrega
**GO somente para auditoria técnica da proteção server-side e teste isolado. NO-GO para UX de caixa completa, migração real, deploy, merge sem fundador, push, produção e declaração de backend concluído.** Encaminhar PR ao Chat 4 (Rules e bypass), Chat 5 (três bots) e Chat 7 (dependências e integração). Preservar a PR #352.


## Atualização Chat 2 — Descoberta autorizada, sem exposição de pares (PR empilhada)
**Consumidor:** Chat 3. **Endpoint proposto** (não publicado): 
`GET /v1/qa/conversations/inbox?limit=20&cursor=<token-opaco>`.
Enviar `Authorization: Bearer <Firebase ID Token QA>`. **Não** enviar `uid`: o backend deriva `ownerUid` do ID token verificado pelo Firebase Admin Auth com checagem de revogação. O backend HTTP fica **desligado por padrão** e responde 503 até integração/autorização específicas.

**Sucesso HTTP 200**:
```json
{"items":[{"chatId":"UID_A__UID_B","peerUid":"UID_B","status":"accepted","lastPreview":"...",
"updatedAtMs":1730000000000,"unreadCount":0,"lastSenderUid":"UID_A"}],
"nextCursor":"token-opaco-ou-null"}
```
O cursor v3 usa **AES-256-GCM**, prazo de dez minutos e vínculo ao UID. Use-o como token opaco. Cursores legados, expirados, adulterados ou de outra conta recebem 403. O limite público é de 1–20. A consulta pede até `limit + 1` entradas por política aceita. O servidor valida todos os itens e o item extra no mesmo snapshot. Só devolve cursor quando há um próximo autorizado e o ancora no último chat entregue. `nextCursor=null` encerra uma consulta bem-sucedida naquele snapshot. Conversas ocultas não ocupam vagas, não contam no lookahead e ficam fora da resposta.

A projeção ordena por validade da elegibilidade do **par**, em ordem crescente, e desempata por ID de documento. O prazo fica dentro da consulta e do cursor cifrado. O JSON não o expõe, mas a ordenação pode indicar a validade relativa de dois pares já autorizados. O cliente não deve interpretar essa ordem como atividade. Cada chamada usa o snapshot atual do servidor. O cursor inclui as revisões privadas do titular nas políticas aceitas. Se uma revisão mudar entre páginas ou se vencer a elegibilidade da âncora, a continuação responde **HTTP 409** com `{"error":"inbox_restart_required"}`, sem itens ou cursor. O cliente descarta a paginação anterior, solicita a primeira página sem cursor e substitui a lista acumulada pelo novo percurso. Deduplicar por `chatId` não recupera itens que mudaram de posição. A mudança em uma política excluída da sessão não invalida seu cursor. Se um par anterior à âncora vencer naturalmente, os sobreviventes conservam a ordem; use uma nova primeira página no refresh/reconexão para atualizar itens já exibidos. O TTL de dez minutos do próprio token e versões antigas seguem com 403.

A descoberta consulta somente a projeção privada por titular e política, `serverInboxOwners/{ownerUid}/{legacy|selfDeclared}/{chatId}`, com `peerExpiresAtMs > agora`. O servidor deriva o titular do token e relê na fonte o chat, a configuração, as elegibilidades e os dois bloqueios. Entradas vencidas saem do intervalo automaticamente, ainda que persistam no Firestore. Cliente titular e terceiros ficam sujeitos à negativa padrão de Rules nessa projeção e no documento de controle. As varreduras de `chats` ficam nas rotinas administrativas de manutenção. Não existe fallback de descoberta em `chats`.

**Erros e cache.** Desligado por padrão, o handler retorna 503. Com handler habilitado, projeção ainda não certificada, consulta indisponível ou divergência durante a revalidação retornam 503 genérico `{ "error": "inbox_unavailable" }`, sem página parcial. Em 503, a UI pode repetir a mesma consulta com espera entre tentativas. Se ao reabrir receber 409, reinicia sem cursor. Auth, elegibilidade do titular e cursor recusados retornam 403. Respostas usam `Cache-Control: private, no-store` e `Pragma: no-cache`.

**Política etária:** o backend aceita **somente** o par legado da composição QA ativa `eligible/2026-11-18plus-qa-v1`. Não reinterpreta `declared_18_plus` da PR #232 como verificação de idade nem habilita o novo par antes de Rules, Worker e identidade convergirem. O código permite configuração **somente do servidor** para futura revisão explícita.

### Carga inicial e manutenção confiável

- **Carga de todo o escopo isolado.** `beginInboxBackfill` abre uma operação privada e grava `ready:false` e a fronteira privada `serverInboxControl/writeBoundary` no mesmo commit. Assim todas as escritas de clientes anteriores a esse commit entram no escopo da carga. A fronteira persiste durante reabertura, rollback e retomada; cada lote verifica a mesma geração. `advanceInboxMaintenance` avança até 20 linhas por transação, com escrita da projeção e checkpoint no mesmo commit. Primeiro percorre a fonte por ID e reconstitui as duas pontas. Depois percorre as duas coleções privadas e verifica cada linha contra chat, dono, política, prazo e bloqueios da fonte, removendo órfãos e excedentes. Um commit com falha mantém o último checkpoint. Após as três fases o controle grava `schema:3`, certificado vinculado à geração da fronteira e `ready:true`. Certificados v2 requerem nova carga integral. Um `ready:true` avulso sem certificado é recusado. A prova usa uma comparação exata dos dois lados, incluindo prazos errados e linhas ausentes.
- **Bloqueio e desbloqueio.** `writeInboxBlock` altera o documento de origem e as projeções das duas pontas em uma transação. O outro sentido permanece válido até sua própria remoção. A transação lê o controle, então ou o bloqueio termina antes de fechar a manutenção ou o comando é recusado antes de tocar a fonte.
- **Elegibilidade.** `beginInboxEligibilityChange` grava concessão, renovação ou troca de política, ou remove a concessão se `grant:null`. A fonte e `ready:false` entram no mesmo commit. Um worker autorizado avança o checkpoint por chats do participante, inclusive para fan-out superior a um lote. O endpoint só volta a servir depois de reconciliar todos os pares afetados. Durante essa janela o 503 é global. ID de operação e versão esperada tornam a repetição idempotente e recusam comandos antigos. Os recibos são privados e precisam de política operacional de retenção antes de exposição.
### Contrato de escrita gerenciada para Android e operação

- **Vedação na fonte.** Na composição gerenciada de QA, a presença da fronteira veda escritas do cliente em `chats/{chatId}`, `messages`, contador de novos pedidos e `blockedMembers`. A elegibilidade é somente administrativa, inclusive quando o cliente usa uma conta moderadora do piloto. A composição de paridade insere a restrição nas concessões originais de bloqueio, pois um segundo match negando a operação não basta no Firestore. No roteiro sintético do piloto, a fronteira também fecha a exceção de listagem legada de `chats`. Configuração de privacidade, ocultação individual e denúncias continuam no próprio escopo, sem mudar a fonte da inbox.
- **Confirmação ao consumidor.** É preciso migrar `AtrioConversations.kt` e `PublicMemberProfile.kt` para as rotas autenticadas correspondentes antes de habilitar a experiência gerenciada. Solicitação inicial, decisões, envio, reação, editar/remover, lidas e exclusão de chat exigem a confirmação da mutação coordenada no servidor. A identidade do ator vem do ID token e o serviço deve preservar a autorização de participantes e os controles de bloqueio, elegibilidade e abuso. O consumidor usa chave estável por intenção, não apresenta confirmação antes do commit e mantém a indicação de pendência durante a indisponibilidade. Bloqueio pendente oculta provisoriamente a conversa no dispositivo; a reabertura permite tentar a mesma operação. Nenhuma tentativa volta à escrita Firestore direta. O contrato de leitura conserva 503 e 409 descritos acima.
- **Limite da certificação.** SDK Admin e REST com credenciais IAM ignoram Security Rules. O fluxo administrativo de elegibilidade deve usar `beginInboxEligibilityChange` e a reconciliação paginada, e os escritores privilegiados que gravavam a origem diretamente precisam perder o acesso de escrita antes do corte real. Isso inclui rotinas operacionais legadas e importadores de fixtures; no Emulator os fixtures de origem entram antes do corte e os testes de corrupção são explícitos e isolados. A fronteira e o certificado comprovam a consistência dos escritores coordenados e das Rules candidatas em QA. Para o remoto ainda são necessários os demais escritores de chat, consumidor, worker, host, Admin Auth de QA com a identidade de serviço prevista, prova de IAM e autorização do fundador. O endpoint remoto permanece fechado.

### Rotas de bloqueio e desbloqueio em QA isolado

Recurso `/v1/qa/conversations/blocks/{peerUid}`. Todas as chamadas usam `Authorization: Bearer <Firebase ID token QA>`, sem corpo ou query string. O ator vem exclusivamente do token verificado pelo Admin Auth com checagem de revogação. Exige-se e-mail verificado, elegibilidade 18+ vigente da política legada e configuração de Conversas ativa. O recurso representa somente o estado do bloqueio feito pelo próprio titular. A rota não consulta a existência do perfil do alvo e não divulga bloqueio recebido ou vínculo entre os pares.

| Método | Uso | HTTP 200 |
| --- | --- | --- |
| `GET` | Ler meu estado e obter a precondição para a primeira tentativa | `{"blocked":false}` e `ETag` atual |
| `PUT` | Bloquear o alvo | Confirmação, estado próprio atual e `ETag` |
| `DELETE` | Desbloquear o alvo | Confirmação, estado próprio atual e `ETag` |

Para `PUT` e `DELETE`, enviar `Idempotency-Key` por intenção (UUID recomendado, 16 a 128 caracteres ASCII alfanuméricos, hífen ou sublinhado) e `If-Match` com a `ETag` **incluindo as aspas**, por exemplo `If-Match: "initial"` na ausência de versão persistida. A chave é isolada por titular. Em timeout, perda de resposta ou 503, repetir exatamente método, alvo, chave e precondição. O commit grava o bloqueio, as duas projeções, a versão e o recibo juntos. Se o outro sentido ainda estiver bloqueado, remover meu bloqueio não restaura a conversa.

A resposta de escrita inclui `{"committed":true,"replayed":false,"requestedBlocked":true,"blocked":true}` e a `ETag` atual. `requestedBlocked` identifica a intenção confirmada. Use `blocked` para a tela. Num retry tardio, `replayed:true` confirma o recibo antigo. `blocked` e a `ETag` correspondem ao estado lido na tentativa atual, inclusive se outra intenção já o mudou. Trate a resposta 200 como confirmação e serialize as intenções do mesmo contato na UI.

- **400 `invalid_request`** para UID malformado, autobloqueio, corpo/query ou cabeçalhos de escrita inválidos. **403 `forbidden`** para sessão, estado de conta ou elegibilidade negados. **405 `method_not_allowed`** para outro método.
- **409 `block_state_changed`** para `If-Match` obsoleto sem recibo correspondente. Refazer o GET e reconciliar a intenção com o estado atual antes de emitir uma nova chave. **409 `block_operation_conflict`** indica reaproveitamento da chave para outro alvo, ação ou precondição.
- **503 `block_unavailable`** durante manutenção, divergência da fronteira ou falha de armazenamento. Manter a intenção pendente e repetir exatamente a operação. **503 `inbox_closed`** no handler fechado por padrão. Respostas são `Cache-Control: private, no-store`.

Em QA, essas rotas são montadas por um teste HTTP em loopback com Auth e Firestore Emulator. A política de retenção dos recibos, rate limiting, a montagem Android e o host remoto seguem pendentes. As demais escritas de conversa seguem na próxima etapa.

**Cache/reconexão:** Firestore ainda pode guardar dados prévios em cache local. Chat 3 deverá limpar projeções de UI no bloqueio/troca de conta, suspender exibição em modo offline de dados sensíveis e exigir atualização do servidor. Uma consulta concluída antes da confirmação do bloqueio pode ter entregue dados anteriormente.

**Custos por página.** Uma consulta indexada por política aceita (uma por padrão, até duas) retorna no máximo 21 linhas por política. Uma transação de snapshot consulta cinco documentos de controle/fronteira/elegibilidade/configuração/revisão e lê no máximo 21 chats e 63 provas de elegibilidade/bloqueio, deduplicadas por par. No caminho padrão, página de 20 com lookahead usa até 21 linhas de índice e 89 leituras pontuais solicitadas. O número de linhas examinadas pela aplicação e de documentos relidos independe do volume de conversas ocultas. Contagem de chamadas no Emulator não mede cobrança, latência de rede ou execução do índice hospedado. A carga varre cada chat e cada entrada privada por política em lotes. Uma alteração de elegibilidade relê os chats do participante afetado. Antes de ativar, auditar a duração da janela 503, amplificação de escritas, latência, rate limiting, erros observáveis e a exposição da ordem de validade.

**Compatibilidade da PR #352:** o bloqueio de GET direto em `chats/{chatId}` e GET/LIST em `messages` é requisito adicional. A nova descoberta **não substitui** a #352, não remove seus gates e deve ser validada em árvore composta por Chat 5/7. Não há merge nem deploy autorizado.
