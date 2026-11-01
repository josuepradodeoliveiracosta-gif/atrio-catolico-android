# Homologação de exclusão de contas — Auth e Firestore Emulators

**Escopo**: PR #71, somente contas fictícias, sem produção. A CI anterior
testava o protocolo de exclusão em memória. Esta etapa importa da PR #98
a suíte administrativa de ponta a ponta para executar Firebase Admin SDK
**real apenas contra Firebase Auth Emulator**, Firestore Emulator e mídia
fictícia servida por HTTP no loopback.

## Passos verificáveis da CI

No job Firestore do workflow existente `.github/workflows/selos-ci.yml`:
1. Os testes originais (Node 20) permanecem obrigatórios.
2. Após sucesso, instala-se Node 22 com suporte a SQLite e
   `firebase-admin@14.5.0` **somente no fixture QA**.
3. `firebase emulators:exec` executa os testes com projeto
   `demo-atrio-v11`, Auth em `127.0.0.1:9099` e Firestore em
   `127.0.0.1:8089`.
4. A suíte valida UID idêntico no Auth/Firestore, duas contas de teste,
   escopo relacional, status/pedido de titular, lease SQLite, ordem das
   etapas, retomada após erros, preservação de dados de terceiros,
   imagens em HTTP local e Auth **por último**.

`GOOGLE_APPLICATION_CREDENTIALS`, service account e Cloudinary de
produção são proibidos. O teste falha em configuração não fictícia.
**Não rodar a suíte contra ambiente ou credenciais reais**. Nenhum Worker,
APK, assinatura, release ou Firebase de produção é modificado.

## Sem autorização para publicar

Mesmo que todos os testes passem: não existem IAM e autenticação de
revisores homologados para exclusão real, fencing completo dos
Workers implantados, decisão jurídica de retenção, inventário vivo,
Cloudinary real aprovado, portal HTTPS funcional e operação observável.
Aprovação desta suíte é **QA de emuladores**, não prova de conformidade
com a LGPD, Play ou eliminação real.

Manter `docs/google-play-privacidade-evidencias.json` com todas as linhas
`verified:false` e `releaseAuthorized:false` até evidências
operacionais distintas e revisão por responsável.
