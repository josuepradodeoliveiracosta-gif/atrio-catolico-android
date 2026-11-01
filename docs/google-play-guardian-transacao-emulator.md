# Transações do Guardião — prova no Firebase Emulator

Executado **somente** na suíte Firestore/Auth Emulator `demo-atrio-v11`
em `tests/security/guardian-firestore-transaction-emulator.test.mjs`.
Utiliza o adaptador REST real do Guardião com `Authorization: Bearer owner`,
reconhecida somente no emulador, e rejeita outros projetos, hosts ou
credenciais reais. Não existe conexão com Firebase/Cloudflare de produção.

O teste valida quatro cenários:
- marcador de exclusão **ausente**: commit de QA permitido;
- marcador de exclusão **presente**: nova gravação negada e documento destino ausente;
- revisão original **desatualizada**: transação não grava parcialmente;
- revisão atual e marcador ausente: verificação combinada e commit bem-sucedidos.

Uma falha não altera a autorização de release e **deve manter a CI vermelha**.
O teste apenas homologa a semântica da transação no emulador; não prova
 IAM de produção, resistência a operações já em andamento em Cloudinary/FCM,
uso correto de marcadores no backend implantado ou exclusão real.
