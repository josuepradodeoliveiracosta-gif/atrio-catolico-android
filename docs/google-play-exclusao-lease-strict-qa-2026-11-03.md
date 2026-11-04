# Átrio Católico — autorização de lease explícita para limpeza de Firestore (QA)

**Data:** 03/11/2026. **Escopo:** exclusão de contas fictícias nos emuladores. **Produção:** não alterada.

## Defeito encontrado

Duas rotinas de exclusão administrativa no Firebase Emulator admitiam a resposta `undefined` ao executar `assertLease()`: `qa-admin-owned-descendant-purge.mjs` e `qa-admin-foreign-reference-cleanup.mjs`. Isso significava que uma função de checagem sem `return true` poderia autorizar exclusões mesmo sem comprovar a validade do lease. A anotação sobre suporte a callbacks antigos (lançam erro para recusar) era incompatível com a regra de segurança de **falha fechada**.

## Correção

As duas rotinas exigem agora `await assertLease() === true` **em todas as barreiras**: antes de inventariar, antes de modificar, após releitura de documento e após cada efeito. Resultados `undefined`, `null`, `false`, `0`, `1`, `'true'` e objetos nunca concedem privilégio. A verificação de autorização `assertAuthorized()` também já exige `true` estrito.

Os callbacks legados precisam retornar explicitamente `true` quando o lease estiver válido; um callback que apenas lança erro se revogado e retorna `undefined` não é uma prova suficiente. Essa mudança é intencional e evita que uma regressão em um adapter silenciosamente habilite uma operação destrutiva.

## Evidência de regressão

Na suíte existente `tests/security/admin-fixture/qa-admin-sdk-e2e.test.mjs`, uma notificação de outra conta e um documento descendente da conta descartável são criados no Firebase Emulator. Para **cada** uma das duas rotinas, os sete resultados não autorizados são injetados como resultados assíncronos de `assertLease`; a execução precisa falhar com `lease_lost` e os dois documentos precisam continuar presentes. O caso de exceção assíncrona continua coberto. São utilizadas somente identidades fictícias; o usuário vizinho deve permanecer intacto.

A alteração não introduz qualquer nova dependência, rota HTTP, segredo, tabela ou processo de produção. Os testes não homologam Firebase remoto nem Cloudinary/FCM reais. Os 15 caminhos de escrita produtivos seguem sem bloqueio distribuído comprovado; `releaseAuthorized:false` e PR #71 draft continuam obrigatórios.

**Próximo trabalho:** construir adaptações com checagem de lease independente e IAM de QA hospedado antes de habilitar mutações reais de provedores. Não é permitido apagar usuários reais com base apenas nesses testes.
