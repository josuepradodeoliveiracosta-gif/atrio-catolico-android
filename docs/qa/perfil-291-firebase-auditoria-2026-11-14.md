# Agente 2 — auditoria Firebase do Perfil 2.0 (PR #291)

**Data:** 14/11/2026 · **Referência congelada:** `b7c9bc8e1a18739db64d0490b71a91c1e4bc4ca3`
**Branch do Agente 2:** `backend/perfil-291-firestore-auth-pagination-qa-20261114`
**Status:** QA isolada; nenhuma alteração de produção, deploy, migração, regras, índice, `main` ou backup.

## 1. Índice no repositório, disponibilidade externa não verificada

`firebase.json` aponta para `firestore.indexes.json`, cujo índice de escopo `COLLECTION` para `posts` contém, nessa ordem, `uid ASCENDING` e `createdAt DESCENDING`. Ele satisfaz a forma de consulta requerida em `ProfileDiscussionHistory.kt` (`whereEqualTo("uid", uid).orderBy("createdAt", DESCENDING)`).

**O arquivo versionado não comprova publicação no Firebase.** Não há conexão administrativa Firebase autorizada disponível no contexto do Agente 2 para consultar a lista de índices remota, nem prova de que a configuração declarada corresponda ao projeto/banco de homologação selecionado. **Status externo: PENDENTE, NÃO CONFIRMADO**. O Firebase Emulator não fornece prova do estado do índice remoto.

Para homologação somente leitura por operador devidamente autorizado:
1. Confirmar ID do projeto **de homologação** e database Firestore correspondentes ao APK QA; não deduzir o destino a partir de `app/google-services.json` de produção.
2. No console Firebase do projeto confirmado, verificar Firestore Database → Indexes → Composite; localizar escopo `Collection`, coleção `posts`, campos `uid Ascending` e `createdAt Descending`, e o estado **Enabled/READY**. Estado `Building`, `Error` ou entrada ausente **não aprova** a consulta.
3. Se credenciais QA com papel estritamente leitor estiverem disponíveis, pode-se obter a lista em operação somente leitura por ferramenta administrativa **aprovada**. Registrar projeto/banco, data, estado, identificador opaco do índice e referência privada sanitizada, sem publicar tokens ou dados.
4. Se a entrada não existir ou não estiver pronta, manter o **NO_GO para integração**. **Não criar índice ou executar deploy** nesta tarefa.

## 2. Registros sem createdAt e paginação

O Firestore exclui de uma consulta com `orderBy(createdAt)` documentos sem esse campo (comportamento definido na documentação oficial). A PR #291 **já resolveu** a lacuna em UI por uma busca **opcional** adicional por UID e `FieldPath.documentId()`, lote de 20, sem migração. Portanto **não duplicar nem sobrescrever o código do Agente 3**.

O novo teste `tests/security/profile-history-auth-query.test.mjs` executa em `demo-atrio-v11` via **Firebase Emulator**:
- 25 posts sintéticos datados do titular, 25 de outro autor e 2 sem data do titular;
- cursor `startAfter(DocumentSnapshot)` com `20 + 5` documentos sem repetições nem UID de outro autor;
- varredura por ID até encontrar os 2 documentos sem `createdAt`;
- consulta ordenada e consulta legada **negadas** para anônimo e usuário com `email_verified=false` quando a política de e-mail está ativa;
- acesso às duas consultas para membro com `email_verified=true`;
- retorno ao comportamento legado após desativação **sintética** da política;
- registro explícito do contrato atual: `posts` é conteúdo comunitário, acessível aos membros elegíveis, inclusive de outro UID. O filtro do Perfil não constitui proteção de privacidade.

A suíte é adicionada ao comando `tests/security/package.json` e não altera regras.

## 3. Segurança e limites

`firestore.rules` em `match /posts/{postId}` permite `get, list` com `signedIn() && emailVerificationAllowsCommunityAccess()`. O filtro `uid` é do cliente para selecionar o histórico, não regra de acesso privativo do autor. O registro de produção não foi consultado. `allow create` exige `createdAt`, mas posts antigos inseridos por Admin/versões anteriores podem não possuir o campo.

A consulta normal usa `limit(20)` e cursor do último `DocumentSnapshot`; a varredura legada também é limitada a 20 por ação do usuário. É possível consumir leituras adicionais ao percorrer todos os posts do titular: esse custo deve ser comunicado no QA. Consultas concorrentes ou alterações durante a navegação podem modificar o conjunto de páginas: não prometer instantâneo global estável.

## 4. Critérios para passagem ao Agente 5 (QA)

- [ ] **Executar e conferir** a nova suíte isolada no commit final, junto às demais regras Firestore.
- [x] Índice requerido está **declarado** e o vínculo em `firebase.json` confere.
- [x] Caminho de compatibilidade sem `createdAt` **já consta** na PR #291; não há migração.
- [x] Contrato de autorização lido nas rules versionadas; a sua publicação remota não foi confirmada.
- [ ] Índice efetivamente disponível em projeto/banco autorizado (**bloqueio externo**).
- [ ] Teste físico: paginação, foco/TalkBack e fonte 150–200%, documentos legados de QA, erro e retry sem dados reais.
- [ ] Aprovação e integração final pelo fundador; sem merge/deploy.

**Encaminhamento condicional:** pode seguir para **Agente 5 — QA isolada e física** quando o novo CI estiver verde, **sem classificar o índice externo como verificado** e sem recomendar integração/release. A aprovação definitiva depende da evidência de índice READY no destino autorizado.

**Referências oficiais:** https://firebase.google.com/docs/firestore/query-data/order-limit-data ; https://firebase.google.com/docs/firestore/security/rules-query ; https://firebase.google.com/docs/firestore/query-data/query-cursors
