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
