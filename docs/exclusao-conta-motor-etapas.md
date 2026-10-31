# Átrio Católico — motor de exclusão por etapas (simulação)

Preparado em 31/10/2026. Esta etapa depende da PR #74 (portal web e auditoria), que depende da PR #73 (solicitação pelo app). A issue #72 **permanece aberta**.

## O que já foi codificado nesta revisão

`cloudflare/account-deletion-audit/src/deletion-orchestrator.js` gera um plano fechado, determinístico e **sem efeito colateral** para a exclusão futura de uma conta. Ele rejeita pedidos não verificados, inventários incompletos, documentos de outros membros, coleções desconhecidas, referências cruzadas não resolvidas, mídia não auditada, decisões de retenção pendentes, aprovação administrativa ausente e paginação incompleta.

`simulatePhases` percorre etapas e simula checkpoints/repetições: a falha de uma fase não marca a fase como concluída, e o próximo ensaio retoma de onde parou. **Não** usa dados de produção ou executa Firebase Admin deleteUser, Firestore delete, Cloudinary destroy ou invalidação FCM.

Todas as respostas de planejamento exibem apenas **contadores, códigos de bloqueio e nomes genéricos** de grupos de dados; não exibem UID, e-mail, token, texto de discussões ou identificadores de mídia.

## Ordem obrigatória para um processador futuro

| Fase | O que deverá ser comprovado |
|---|---|
| 1. Bloqueio de novas escritas | Identidade revalidada, canal de contato, acesso/produção de novos registros interrompido sem retirar o direito de acompanhamento |
| 2. Subcoleções particulares | `users/{uid}/likedPosts`, `savedPosts`, `followedPosts`, `pushDevices`, `notifications` e `guardian_notices/{uid}/items`, incluindo documentos órfãos |
| 3. Conteúdo e referências | `posts` com `uid`, `posts/*/replies` com `uid`, `reactions`, notificações `actorUid` em outras contas, menções, respostas citadas |
| 4. Retenções e moderação | `reports`, `guardian_cases`, `guardian_audit`, `guardiao_quarantine`: decisão justificada para apagamento ou desidentificação, sem apagar dados de terceiros |
| 5. Mídia | Cloudinary `profile_photos`, imagens publicadas/pedentes e registros D1 de avatar; conferir o sucesso da remoção na origem |
| 6. Documentos próprios | `profiles`, `public_profiles`, `profile_photos`, `badges`, `badge_requests`, `admins`, documento `users` (sempre depois das subcoleções) |
| 7. Varredura residual | Repetir consultas paginadas, verificar usuários, imagens, notificações, vínculos e referências em outras contas |
| 8. Firebase Authentication | **Somente depois** de confirmar exclusões/anonimizações e tratar falhas parciais, excluir a identidade e revogar acesso |
| 9. Encerramento | Estado final verificável e comprovante mínimo de atendimento, com retenção documentada e sem dados sensíveis desnecessários |

### Requisitos técnicos ainda não solucionados

1. **Não existe adapter de produção.** Nenhum Worker ativo tem permissão de exclusão; qualquer execução destrutiva deve usar um backend separado, com contas de serviço de privilégio mínimo, aprovação dupla, proteção contra concorrência e logs de auditoria sem PII.
2. **Inventário real ainda precisa ser implementado.** Enumerar documentos em lotes paginados, atravessar subcoleções órfãs, fazer consultas por UID e collection group onde necessário. O Firestore **não** apaga subcoleções ao excluir um pai.
3. **Cross-user e mídia:** remover/anomimizar referências do solicitante em notificações de terceiros sem apagar a conta ou os dados de outras pessoas. D1 de avatar pendente e Cloudinary podem conter mídia não representada em documentos Firestore. Confirmar cada origem.
4. **Retenção e moderação:** estabelecer base legal/política de retenção, critérios de desidentificação e prazo de atendimento; tratar relatórios que envolvam outros membros, sem descartar evidências legitimamente retidas.
5. **Revalidação de titularidade e privacidade:** proteger o requerente de erro de identidade, evitar sobrescrever solicitações e permitir acompanhamento mesmo após restrição da conta.
6. **Operação idempotente e resumível:** checkpoints precisam ser persistidos em backend com controle de concorrência e uma trilha verificável. O teste simula esta regra, mas ainda não é checkpoint real.
7. **Página pública:** hospedar portal HTTPS verificado, configurar domínio Firebase e publicação de política de privacidade após o executor completo estar homologado.
8. **Homologação:** testes com duas contas fictícias, falha de rede entre fases, mídia ausente, tokens FCM inválidos, registros orphaned e continuação após retry, sempre em projeto Firebase de QA.

## Proteções explícitas

- `buildDeletionPlan(...).safeToExecute` é **sempre false** no código.
- `simulatePhases` só aceita planos de simulação e não importa clientes ou credenciais dos serviços.
- Nenhuma PR deste conjunto modifica usuários, bancos ou Workers de produção.
- O serviço de auditoria da PR #74 continua sem endpoint de execução.
- **Não mesclar #73–#75 como recurso de produção** nem anunciar conformidade Play antes do backend completo.

## Testes e custo

CI existente: `node --test cloudflare/account-deletion-audit/src/*.test.js tests/security/account-deletion-web.test.mjs`.
São testes offline, sem custo de Cloudflare ou Firebase em produção. Testes Android/Firestore existentes continuam.

Documentação oficial consultada: https://firebase.google.com/docs/firestore/data-model e https://firebase.google.com/docs/auth/admin/manage-users
