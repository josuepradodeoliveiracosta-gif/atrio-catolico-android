# Átrio Católico — inventário Firestore Push de QA: acesso somente leitura

**03/11/2026 · PR #71 · não implantado.**

O novo módulo `cloudflare/account-deletion-audit/src/qa-firestore-push-readonly-inventory.js` implementa o contrato paginado `readPage({uid,type,cursor,limit})` utilizado por `captureQaExternalBaseline` e `verifyQaExternalReadback`.

## Escopo e garantias

- API REST oficial Firestore: **GET** `https://firestore.googleapis.com/v1/projects/{qaProject}/databases/(default)/documents/users/{uid}/pushDevices`, com `pageSize=25` e paginação por `pageToken`.
- **Máscara de campos obrigatória**: `qaFingerprint` e `qaRevision`, jamais o token FCM real. Todos os campos inesperados, inclusive `token`, invalidam a resposta. Os dados sintéticos devem ser previamente inseridos em um projeto QA independente e seguir `users/qa-freeze-alice|qa-freeze-bob/pushDevices/qa-device-*`.
- Projeto remoto só é aceito com nome `atrio-*-qa-*`, distinto do projeto produtivo conhecido `atrio-catolico`, e **números de projeto QA e produção diferentes**. Exige um callback `inspectProjectIdentity` que deve consultar a identidade do projeto em fonte administrativa confiável em cada página.
- Sem descoberta automática de credenciais: o `fetcher`, um token OAuth limitado e a fonte de identidade precisam ser injetados explicitamente. O módulo não contém `deleteUser`, revogação FCM, Firebase Admin SDK ou escrita Firestore.
- Respostas HTTP só em JSON UTF-8, máximo 64 KiB, com nome de documento, versão e campos de QA estritamente validados. Cursor remoto é encapsulado em base64url canônico para ser compatível com o verificador de inventário sem modificar ou inventar o token retornado pelo servidor.
- A prova independente de antes/depois é obtida somente quando os adaptadores de Cloudinary, dispositivos e freeze forem combinados com uma operação de limpeza **que ocorre fora desses verificadores**. Duas leituras vazias do titular e preservação do outro usuário não demonstram por si só revogação de tokens FCM legados, CDN, derivados e backups.

O módulo devolve explicitamente `crossProjectIamVerified:false`, `remoteTokenRevocationVerified:false` e `productionReady:false`. O callback `inspectProjectIdentity` por si só **não é uma certificação de IAM**; essa prova dependerá de conectores com autoridade e revisão humana. Uma string de projeto com `qa` no nome também não garante isolamento real.

## Testes

`qa-firestore-push-readonly-inventory.test.js` contém nove cenários: máscara e HTTP GET, segregação/projeto, troca de identidade, rejeição de UID real, tipo/cursor/tamanho, continuação de página com token remoto, registros inesperados, falhas HTTP e duas leituras independentes antes/depois com outra conta preservada. Tudo usa respostas simuladas de formato Firestore; **não há acesso a Google Cloud real na CI**.

A integração pública de exclusão e o executor hospedado ainda não estão prontos: não foi comprovado projeto Firebase remoto QA conectado nem Cloudinary independente com credenciais QA. Nenhuma exclusão remota ou lançamento Play pode ser autorizado com base nestes testes.

## Próxima etapa segura

Confirmar o projeto QA real e as identidades de ambos os ambientes, guardar credenciais exclusivamente nos serviços segregados, realizar inventário somente-leitura dos dois UIDs artificiais e comparar antes/depois. Só então habilitar adapters remotos de **exclusão de fixtures** sob ticket HMAC/D1, IAM, retenção e reconciliação, mantendo a exclusão Auth por último.

Fontes: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list e https://firebase.google.com/docs/firestore/use-rest-api
