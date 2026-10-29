# Guardião V2 — reanálise de discussões antigas editadas (QA)

**Status: implementado na PR #44, NÃO implantado no Firebase oficial nem na versão publicada.**

## Problema resolvido

A varredura anterior filtrava apenas `createdAt`. Se alguém editasse hoje uma discussão criada há muitos dias, o Guardião não a reencontraria automaticamente, mesmo com o histórico de casos versionado.

## Implementação

1. **Android:** o botão *Salvar* do editor de discussões passa a enviar `updatedAt: FieldValue.serverTimestamp()` junto do título e do corpo. As respostas não possuem edição pelo cliente e suas regras continuam `allow update: if false`.
2. **Firestore Rules (somente repositório de testes):** toda edição de discussão pelo cliente deve incluir `updatedAt == request.time`, com diferenciais limitados a `title`, `body`, `updatedAt`. `uid`, `authorName`, `category` e `createdAt` continuam protegidos.
3. **Firestore REST:** `scanPage` agora recebe `field='updatedAt'` apenas para `posts`, mantendo validação de janela, ordenação estável `updatedAt DESC` + `__name__ DESC`, cursor validado e páginas limitadas.
4. **Scanner:** `scanPagedCycle` tem uma quarta trilha `post_edits` com checkpoint privado `guardian_runtime/scan_post_edits`, duas páginas de no máximo 15 discussões editadas por ciclo. É independente de `scan_posts` (`createdAt`) para não atrasar o processamento de publicações novas.
5. **Casos:** `processDocument` preserva o histórico por `sourceUpdateTime` e usa verificação atômica de `updateTime`; uma edição posterior pode gerar nova análise sem modificar o caso anterior, e uma edição simultânea impede registrar uma conclusão obsoleta.

## Segurança, compatibilidade e custo

- **NÃO PUBLICAR essas regras isoladamente no Firebase oficial.** APKs antigos fazem edição sem `updatedAt` e perderiam a capacidade de editar após a regra rígida ser ativada. Exige lançamento coordenado do APK compatível, validação dos usuários e só depois das regras.
- Documentos antigos sem `updatedAt` permanecem legíveis e consultáveis pela trilha de criação. Ao receber uma edição pelo APK novo, entram na trilha de atualização.
- Edições feitas por Admin SDK/serviços privilegiados sem `updatedAt` não entram na nova trilha; exigir o mesmo contrato dos backends antes de produção.
- A leitura `updatedAt` poderá precisar de índices reais; confirmar no Firebase QA antes de aprovar a implantação. O emulador não assegura índices de produção.
- Em cenários de grande movimento, a varredura continua limitada; checkpoints e `backlogGroups` sinalizam atraso, mas não garantem tempo máximo de resposta nem cobertura universal em falha prolongada.
- Sem nova API, Cloud Run, Cloud Scheduler, cobrança, segredo ou mudança no Worker Push. Nenhuma punição de usuários reais foi ativada.

## Testes

- `src/scan-paged.test.js`: verifica leitura de edições de posts antigos, checkpoint independente, lote de 33 edições em 30+3, rejeição do `updatedAt` em grupos sem edição.
- `tests/security/moderation.test.mjs`: aceita edição com timestamp de servidor e rejeita edição sem timestamp ou com data fornecida pelo cliente.
- `tests/security/guardian-v2-paged-emulator.mjs`: edita uma discussão antiga no Firestore Emulator com usuário autenticado, exige que reapareça na trilha `post_edits`, gere caso de revisão e continue visível.
- A suíte roda na branch `feature/guardiao-autonomo-20261029`. A confirmação final depende do GitHub Actions desse commit.

**Próximo bloqueador antes de liberar produção:** coordenar compatibilidade dos APKs e validar índices no QA real, mantendo `GUARDIAN_V2_ENABLED=false`.
