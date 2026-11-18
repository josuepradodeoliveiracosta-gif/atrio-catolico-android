# Chat 3 — migração UI da inbox para o contrato #355

**Base:** PR #357 HEAD `89a7313b8b67ed1624e9235f6295a8933e242c55`; `main@74358dcb` era a base da #357. **Branch:** `feat/chat3-inbox-peer-ui-issue355-20261118`. **PR #354:** preservada e não incorporada.

## Segurança e comportamento

- Remove a chamada global `collection("chats").whereArrayContains("participants", uid)` da interface.
- O único índice de inbox consultado é `users/{uid}/chatInboxByPeer/{peerUid}/entries.limit(20)`, para par previamente conhecido pelo perfil ou ID exato de conversa. Somente `Source.SERVER`; nenhum `collectionGroup` e nenhum `chatBox` usado como fonte de descoberta.
- O cliente valida campos mínimos do documento materializado (ownerUid, peerUid, chatId, status, lastPreview, updatedAt) antes de mostrar qualquer prévia. Os papéis de solicitante/destinatário não existem no índice e não são inferidos. O texto de solicitação é neutro até a DM ser validada no servidor.
- Na transição de sessão, falha de autorização ou ausência de rede, a lista de mensagens é esvaziada, a tela apresenta erro e permite `Tentar novamente`; erro desaparece na reconexão. Bloqueio realizado pelo titular oculta imediatamente o par por listener próprio; bloqueio remoto depende da revalidação periódica das Rules no servidor. Nunca mostrar “nenhuma conversa” quando houve erro.
- A thread só abre para índice autorizado ou primeiro contato iniciado explicitamente do perfil. Leitura do documento de DM revalidada em `Source.SERVER`; mensagens do cache não são mostradas como confirmação de servidor.
- A primeira mensagem para um contato vindo do perfil pode ser tentada sem índice prévio; Rules decidem autorização. Sem materializador acionado, a nova conversa não aparecerá na lista ainda. **Não abrir acesso remoto para contornar isso.**

## Bloqueio de produto que depende do Chat 2

O contrato #357 **não inclui descoberta autorizada de contatos** e não habilita o materializador nem o backfill. Por isso a inbox geral, solicitações e arquivadas **não ficam completas** neste patch: aparecem instruções honestas para iniciar conversas por perfil. Uma consulta por ID exato conhecido funciona apenas se existir índice server-side autorizado. Não usar consultas globalmente filtradas, `chatBox`, UIDs extraídos de consultas inseguras ou índices controláveis pelo cliente como substitutos.

**Chat 2:** fornecer fonte autenticada de descoberta de pares sem UIDs e contagens de conversas bloqueadas; materializar índices em criação/edição/bloqueio/desbloqueio/revogação e viabilizar migração QA offline. Validar compatibilidade com #352: GET/histórico precisam negar bloqueio bilateral. Verificar custos/leitura por par e corrida entre commits.

**Chat 4:** auditar que a UI não reabre dados privados via cache, retorno de outra conta ou primeira mensagem e que a descoberta/servidor são barreiras finais.

**Chat 5:** execução da matriz dos três bots na composição exata de #357 + Chat 3, com fixtures de índice *confiáveis no Emulator*, sem reativar `list(chats)`. Substituir asserções do teste antigo que contam todos os chats por provas de índice autorizado e negativas. Testar desconexão, reconexão, bloqueio A/B, notificações com ID conhecido, primeira mensagem sem índice, e sem UID conhecido. Teste físico não é requisito de QA quando os três bots cobrem os critérios (§21).

**Chat 7:** revisar dependências, conflitos com #352, #354 e mudanças dos Chats 2/5; liberar apenas após CI compatível. **NO-GO para merge/deploy** sem autorizações separadas do fundador.

### Limites
A aprovação de compilação/Rules isoladas não comprova a homologação integral; o teste de bot antigo dependerá de adaptação dos fixtures do Chat 5. Este trabalho não modifica Rules, Worker, Firebase remoto, dados reais ou produção.
