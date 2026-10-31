# QA — Firebase Admin SDK com o mesmo UID no Auth e Firestore

**Data:** 31/10/2026. Base: PR #96. Escopo: **somente homologação local**.

## Alteração implementada

O diretório `tests/security/admin-fixture/` possui dependência exclusiva
`firebase-admin@14.5.0` (Node 22) e testes com o **Firebase Admin SDK
verdadeiro conectado aos emuladores locais**, nunca à infraestrutura real.

- Projeto exclusivo: `demo-atrio-v11`.
- Firebase Authentication Emulator: `127.0.0.1:9099`.
- Firestore Emulator: `127.0.0.1:8089`.
- Identidade de exclusão: `qa-delete-alice`.
- Identidade protegida: `qa-delete-bob`.
- Não são usadas credenciais de serviço, tokens de produção ou contas reais.
- Os dois `createUser({uid})` criam **UID idêntico ao documento**
  `profiles/{uid}` e `users/{uid}`. A verificação administrativa
  usa `getUser(uid)` e a exclusão usa `deleteUser(uid)`.
- Uma nova instância de Admin SDK após falha busca o UID diretamente no
  Auth Emulator; não depende de mapa de IDs em memória.

## Testes de interrupção / isolamento

O teste `qa-admin-sdk-e2e.test.mjs` executa o fluxo administrativo de QA
com aprovações fictícias, lease SQLite, Firestore Emulator, Auth Emulator
e o Cloudinary **simulado por HTTP local**.

1. Simula HTTP 503 ao apagar mídia: interrompe antes do Auth.
2. Simula indisponibilidade de Auth antes do efeito: Auth não é apagado.
3. Exclui a identidade Auth no emulador e interrompe antes do checkpoint.
4. Descarta a instância Admin SDK, cria outra e reexecuta a fase.
5. Verifica ausência da conta Alice e dados conhecidos, preservação
   integral da conta Bob e sua mídia, e idempotência na repetição.
6. Rejeita UID estranho, exclusão direta de Bob e ambiente com host
   de Auth externo (sem realizar a chamada proibida).

A CI instala a dependência **somente nesse subdiretório**, sem alterar
as dependências do APK, sem segredos e sem tentar qualquer deploy.
Os dois emuladores são iniciados pelo workflow antes de executar os testes.

## Limitações que impedem produção e fechamento da issue #72

- `getAuth` e `deleteUser` exercitam **Admin SDK de verdade**, mas
  contra **Auth Emulator**. Não demonstram IAM/autorização de produção.
- Os revisores e a retenção ainda são fixtures, sem identidade
  administrativa autenticada nem política legal homologada.
- Inventários relacionais incompletos, coleções desconhecidas, cron e
  Workers com bypass, FCM, backlinks e mídia Cloudinary verdadeira
  exigem implementação/validação independente.
- A checagem local de lease não cancela requisições remotas em curso.
  O congelamento persistente de escrita deve ser imposto por todos os
  serviços antes da autorização de exclusão.
- O portal HTTPS do titular ainda não foi implantado.
- O **backup protegido, assinatura Android permanente, OTA, APK/AAB,
  Play Console, main e dados de produção** permanecem intocados.

**Readiness:** `productionIntegrated=false`,
`firebaseAdminEmulatorTested=true` **somente se a CI comprovar**,
`productionIamApproved=false`,
`cloudinaryRealDeletionTested=false`,
`playDeletionCompliant=false`.

Fontes técnicas:
- https://firebase.google.com/docs/emulator-suite/connect_auth
- https://firebase.google.com/docs/auth/admin/manage-users
