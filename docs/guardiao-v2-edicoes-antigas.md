# Guardião V2 — reanálise de discussões antigas editadas (QA)

**Status: implementado na PR #44, NÃO implantado no Firebase oficial nem na versão publicada.**

## Problema resolvido

A varredura anterior filtrava apenas `createdAt`. Se alguém editasse hoje uma discussão criada há muitos dias, o Guardião não a reencontraria automaticamente, mesmo com o histórico de casos versionado.

## Implementação

1. **Android:** o botão *Salvar* do editor de discussões passa a enviar `updatedAt: FieldValue.serverTimestamp()` junto do título e do corpo. As respostas não possuem edição pelo cliente e suas regras continuam `allow update: if false`.
2. **Firestore Rules (somente repositório de testes):** o APK novo inclui `updatedAt == request.time`. Como transição, APKs antigos podem alterar apenas `title` e `body`, sem modificar `updatedAt`. Mudanças em `updatedAt` precisam ser do servidor; autoria, criação e categoria permanecem imutáveis. `uid`, `authorName`, `category` e `createdAt` continuam protegidos.
3. **Firestore REST:** `scanPage` agora recebe `field='updatedAt'` apenas para `posts`, mantendo validação de janela, ordenação estável `updatedAt DESC` + `__name__ DESC`, cursor validado e páginas limitadas.
4. **Scanner:** `scanPagedCycle` tem uma quarta trilha `post_edits` com checkpoint privado `guardian_runtime/scan_post_edits`, duas páginas de no máximo 15 discussões editadas por ciclo. É independente de `scan_posts` (`createdAt`) para não atrasar o processamento de publicações novas.
5. **Casos:** `processDocument` preserva o histórico por `sourceUpdateTime` e usa verificação atômica de `updateTime`; uma edição posterior pode gerar nova análise sem modificar o caso anterior, e uma edição simultânea impede registrar uma conclusão obsoleta.

## Segurança, compatibilidade e custo

- **NÃO PUBLICAR as regras isoladamente no Firebase oficial.** A regra de transição no repositório permite tanto o APK novo quanto o antigo; exige validação em QA e autorização explícita antes de qualquer implantação. Quando toda a comunidade estiver em APK compatível, poderá ser proposta uma regra mais rígida.
- Documentos antigos sem `updatedAt` permanecem legíveis e consultáveis pela trilha de criação. Ao receber uma edição pelo APK novo, entram na trilha de atualização.
- **Limitação deliberada:** edições pelo APK antigo **não aparecem na nova fila** porque não enviam `updatedAt`. Assim, a fila não garante cobertura de 100% durante a transição. Um cliente modificado pode se passar por legado; Firestore Rules não conseguem comprovar a versão do APK só pelos campos. Não afirmar proteção completa até a migração ser concluída.
- Edições feitas por Admin SDK/serviços privilegiados sem `updatedAt` também não entram na nova trilha; exigir o mesmo contrato dos backends antes de produção.
- O Firestore usa índice automático de coleção para `posts.updatedAt`, mas `replies.createdAt` em collection-group exige índice específico. O manifesto **QA** `cloudflare/guardian-worker/firestore.qa.indexes.json` agora contém `fieldOverrides` para `replies.createdAt` descendente em `COLLECTION_GROUP`, preservando os dois modos da coleção. **Somente o arquivo foi alterado; nenhum índice foi publicado nem verificado READY no Firebase QA nesta rodada.** O emulador não garante índices de produção.
- Em cenários de grande movimento, a varredura continua limitada; checkpoints e `backlogGroups` sinalizam atraso, mas não garantem tempo máximo de resposta nem cobertura universal em falha prolongada.
- Sem nova API, Cloud Run, Cloud Scheduler, cobrança, segredo ou mudança no Worker Push. Nenhuma punição de usuários reais foi ativada.

## Testes

- `src/scan-paged.test.js`: verifica leitura de edições de posts antigos, checkpoint independente, lote de 33 edições em 30+3, rejeição do `updatedAt` em grupos sem edição.
- `tests/security/moderation.test.mjs`: aceita edição nova com timestamp de servidor **e edição legada sem timestamp**, preserva horário anterior e rejeita data forjada.
- `tests/security/guardian-v2-paged-emulator.mjs`: edita uma discussão antiga pelo APK novo no emulador, exige reanálise sem exclusão; testa também edição legada sem `updatedAt`.
- `src/qa-indexes.test.js`: preserva índices QA existentes e verifica a definição de `replies.createdAt` com escopo collection-group.
- A suíte roda na branch `feature/guardiao-autonomo-20261029`. A confirmação final depende do GitHub Actions desse commit.

**Ordem de implantação futura (ainda não autorizada):** 1) teste QA com índices READY, 2) APK novo, 3) regras de transição, 4) monitorar adoção de versões, 5) somente após aprovação explícita remover o caminho legado e exigir `updatedAt` em todas as edições. Manter `GUARDIAN_V2_ENABLED=false` e nenhuma punição real durante todo o processo.
