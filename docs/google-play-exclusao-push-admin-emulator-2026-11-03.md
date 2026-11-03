# Átrio Católico — Firebase Push Devices: limpeza administrativa no Emulator

Data: 03/11/2026. Integração somente QA, PR #71 (rascunho). **Não é autorização de produção nem de publicação Play.**

## O que foi acrescentado

`tests/security/admin-fixture/qa-push-devices-emulator.mjs` usa o **Firebase Admin SDK real somente contra o Firestore Emulator** local, com o projeto `demo-atrio-v11`, o par de UIDs fictícios `qa-push-revoke-alice` / `qa-push-revoke-bob` e um case ID fixo de teste. Rejeita a ausência de `FIRESTORE_EMULATOR_HOST=127.0.0.1:8089`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` e `GCLOUD_PROJECT=demo-atrio-v11`. Também rejeita credenciais Google, Cloudinary e chaves de exclusão real. Não é exportado por nenhum Worker.

O módulo:
- Exige uma solicitação de exclusão fictícia e marcador `account_deletion_freeze` persistente vinculado ao mesmo UID e caso, sem removê-lo depois.
- Percorre, por ordem de `documentId` e com limite fixo, **todos** os documentos `users/{uid}/pushDevices`, inclusive os com token vazio, vencido, ausente ou malformado. Não usa `devices()` do Worker de envio, que filtra tokens, nem lê campos de token.
- Registra somente caminhos e versões de atualização da conta de QA e de seu vizinho; não lê valores sensíveis.
- Exige baseline não vazio de ambas as contas e faz `WriteBatch.delete` com `lastUpdateTime` de cada documento, evitando apagar registros que mudaram entre o inventário e a exclusão. Conflitos impedem certificar remoção parcial como sucesso.
- Executa duas leituras independentes depois do lote, comprova 0 documentos de Alice e dados de Bob com caminhos/versões inalterados.
- Retorna explicitamente `realFcmTokenRevocationVerified:false`, `legacyTopicSubscriptionsVerified:false`, `productionWorkerFenceVerified:false` e `playReleaseAuthorized:false`.

`tests/security/admin-fixture/qa-push-devices-emulator.test.mjs` testa o módulo com **o Firestore Emulator real**: 27 documentos sintéticos para Alice (alguns com tokens falsos inválidos e metadados antigos), dois documentos para Bob, bloqueio de nova inscrição pelo **Security Rules SDK** após freeze, rejeição de UID/case indevido, conflito de atualização concorrente que interrompe o lote inteiro, nova tentativa controlada e duas leituras pós-deleção. Não remove Firebase Auth nem faz chamadas ao FCM.

O teste foi incorporado à **execução já existente** `npx firebase emulators:exec --only firestore,auth --project demo-atrio-v11` do workflow `.github/workflows/selos-ci.yml`, sem criar um workflow, emulador extra ou compilar APK/AAB adicional.

## Escopo e limites obrigatórios

1. **Não existe comprovação de projeto Firebase QA remoto independente**, com IAM e credenciais limitadas. O emulador não valida segurança IAM de um projeto hospedado.
2. No aplicativo real, Android pode chamar `deleteToken()` e desinscrever-se de tópicos locais. Isso não revoga retroativamente todos os tokens de outros dispositivos, nem comprova ausência de mensagens pendentes no FCM.
3. O Admin SDK bypassa regras Firestore; todas as rotinas administrativas e Workers que possam escrever devem implementar a mesma barreira persistente. O teste protege apenas o escritor participante e o cliente sujeito a regras do emulador.
4. A exclusão Auth só pode ocorrer **depois** das verificações independentes das coleções e provedores, e depois de decisão documentada de retenção de moderação/terceiros.
5. A Cloudinary conectada não foi comprovada como separada. Nenhum `upload`, `destroy`, purga de derivativos, CDN ou backup foi executado.

**Próximas provas para publicação:** criar/autorizar Firebase QA separado e Cloudinary QA separado, verificar projeto/conta por identificador independente e pré-condições, testar exclusão com credenciais somente QA e segunda conta controle, auditar inscrições legadas de FCM, permissões, IAM, retenção LGPD e requisitos Play. **Sem essas provas, `releaseAuthorized:false` e PR draft permanecem.**
