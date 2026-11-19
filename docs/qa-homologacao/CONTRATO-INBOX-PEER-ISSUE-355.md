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
O cursor v2 usa **AES-256-GCM**, prazo de dez minutos e vínculo ao UID. Use-o como token opaco. Cursores legados, expirados, adulterados ou de outra conta recebem 403. O limite público é de 1–20. A consulta pede até `limit + 1` entradas por política aceita. O servidor valida todos os itens e o item extra no mesmo snapshot. Só devolve cursor quando há um próximo autorizado e o ancora no último chat entregue. `nextCursor=null` encerra uma consulta bem-sucedida naquele snapshot. Conversas ocultas não ocupam vagas, não contam no lookahead e ficam fora da resposta.

A projeção ordena por validade da elegibilidade do **par**, em ordem crescente, e desempata por ID de documento. O prazo fica dentro da consulta e do cursor cifrado. O JSON não o expõe, mas a ordenação pode indicar a validade relativa de dois pares já autorizados. O cliente não deve interpretar essa ordem como atividade. Cada chamada usa o snapshot atual do servidor. Mudanças de autorização ou renovação de prazo podem alterar a ordem entre chamadas. Para atualizar a listagem, o cliente reinicia sem cursor e pode deduplicar itens por `chatId`.

A descoberta consulta somente a projeção privada por titular e política, `serverInboxOwners/{ownerUid}/{legacy|selfDeclared}/{chatId}`, com `peerExpiresAtMs > agora`. O servidor deriva o titular do token e relê na fonte o chat, a configuração, as elegibilidades e os dois bloqueios. Entradas vencidas saem do intervalo automaticamente, ainda que persistam no Firestore. Cliente titular e terceiros ficam sujeitos à negativa padrão de Rules nessa projeção e no documento de controle. A única varredura por `participants array-contains` fica na rotina administrativa de backfill. Não existe fallback de descoberta em `chats`.

**Erros e cache.** Desligado por padrão, o handler retorna 503. Com handler habilitado, projeção ainda não certificada, consulta indisponível ou divergência durante a revalidação retornam 503 genérico `{ "error": "inbox_unavailable" }`, sem página parcial. Em 503, a UI pode repetir a consulta conforme sua política de retry. Auth, elegibilidade do titular e cursor recusados retornam 403. Respostas usam `Cache-Control: private, no-store` e `Pragma: no-cache`.

**Política etária:** o backend aceita **somente** o par legado da composição QA ativa `eligible/2026-11-18plus-qa-v1`. Não reinterpreta `declared_18_plus` da PR #232 como verificação de idade nem habilita o novo par antes de Rules, Worker e identidade convergirem. O código permite configuração **somente do servidor** para futura revisão explícita.

**Materialização e condição de ativação.** A reconciliação lê chat, idades e os dois bloqueios e escreve a projeção de ambos os donos na transação que mantém as vistas por contato. Edições, remoções e eventos repetidos reavaliam a fonte. `backfillInboxBatch` aceita até 40 chats por chamada administrativa e deve voltar a reconciliar pares após revogação, mudança de política ou renovação de elegibilidade. O caminho de leitura exige `serverInboxControl/pagination` com `{ready:true,schema:1}`. Somente o backend confiável pode certificar esse estado depois do backfill completo e da verificação de que toda mutação da fonte mantém a projeção no mesmo commit ou fecha o controle antes da mutação e o reabre após reconciliação. Escritas legadas diretas e gatilhos assíncronos, sozinhos, não satisfazem essa condição. A revalidação detecta linhas indevidas na página, mas uma linha ausente só é evitada pela completude do índice e pela disciplina dos escritores. Eventos, backfill, caminhos de escrita de chat/bloqueio/elegibilidade, Firebase Admin Auth, host e IAM ainda precisam de ligação real. Mantenha o endpoint fechado até que essa invariável seja demonstrada na composição de integração. O Emulator usa dados fictícios e um documento de controle explícito.

**Cache/reconexão:** Firestore ainda pode guardar dados prévios em cache local. Chat 3 deverá limpar projeções de UI no bloqueio/troca de conta, suspender exibição em modo offline de dados sensíveis e exigir atualização do servidor. Uma consulta concluída antes da confirmação do bloqueio pode ter entregue dados anteriormente.

**Custos por página.** Uma consulta indexada por política aceita (uma por padrão, até duas) retorna no máximo 21 linhas por política. Uma transação de snapshot consulta três documentos de controle/elegibilidade/configuração e lê no máximo 21 chats e 63 provas de elegibilidade/bloqueio, deduplicadas por par. No caminho padrão, página de 20 com lookahead usa até 21 linhas de índice e 87 leituras pontuais solicitadas. O número de linhas examinadas pela aplicação e de documentos relidos independe do volume de conversas ocultas. Contagem de chamadas no Emulator não mede cobrança, latência de rede ou execução do índice hospedado. Antes de ativar, auditar latência, rate limiting, erros observáveis e a exposição da ordem de validade.

**Compatibilidade da PR #352:** o bloqueio de GET direto em `chats/{chatId}` e GET/LIST em `messages` é requisito adicional. A nova descoberta **não substitui** a #352, não remove seus gates e deve ser validada em árvore composta por Chat 5/7. Não há merge nem deploy autorizado.
