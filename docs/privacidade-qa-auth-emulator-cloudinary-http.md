# QA: Firebase Authentication Emulator + Cloudinary HTTP local

Continuidade da PR #95, 31/10/2026.

## O que executa

A nova integração de exclusão administrativa usa serviços externos **somente
como fixtures**, totalmente separados das contas do Átrio:

1. Firebase Auth Emulator real em `127.0.0.1:9099`, com projeto
   descartável `demo-atrio-v11`, e IDs `qa-delete-alice` /
   `qa-delete-bob`. Cria, consulta e exclui somente a primeira conta
   de teste. Nenhum token de produção é aceito.
2. Firebase Firestore Emulator real em `127.0.0.1:8089` — conteúdo
   fictício de duas contas, com solicitação e revisões de fixtures.
3. Servidor HTTP temporário Node escutando em `127.0.0.1`, porta
   aleatória, no papel de um **Cloudinary falso**. O contrato de teste
   usa `POST /v1_1/qa-atrio-only/image/destroy`, mas não é a API
   Cloudinary real, não usa assinatura real, nem chave Cloudinary.
4. Diário SQLite temporário com lease/fencing; o executor valida
   dados e mídia antes de tocar na conta Auth do emulador.

A CI inicia os emuladores com `--only firestore,auth`, executa
`qa-auth-cloudinary-emulator.test.mjs` e mantém os testes anteriores.

## Cenário de falha parcial

O servidor HTTP devolve erro 503 no primeiro pedido de exclusão de
mídia. A execução deve interromper antes do Auth, deixando a conta
fictícia intacta. Após reinício, o executor revalida a autorização,
remove a imagem falsa, exige comprovação de ausência de dados e
só então remove a identidade de Auth **emulada**. A conta Bob
e sua mídia fictícia não são alteradas. Repetição do processamento
não deve gerar exclusões indevidas.

## Limites importantes

- A chamada REST do Auth Emulator usa login e exclusão **do próprio
  usuário de teste**, para validar o ciclo de vida remoto. Não
  demonstra a permissão administrativa do Firebase Admin SDK.
- Os identificadores e revisores são estáticos de QA. A validação
  de dupla aprovação **não representa** autenticação real, IAM,
  MFA, assinatura ou revisão legal de retenção.
- A remoção de mídia é um servidor HTTP em loopback; falhas reais
  da Cloudinary, assinaturas, derivações e backups permanecem
  **não testados**.
- Firestore é somente o emulator; freeze/Workers, coleções legadas,
  dados relacionais não indexados, dispositivos antigos, retenções
  e exclusão administrativa real ainda exigem desenvolvimento.
- Um lease verificado antes de uma requisição **não reverte**
  efeitos remotos em trânsito; a implementação real precisa de
  idempotência persistente e bloqueio em todas as fontes de escrita.
- Nenhuma credencial Firebase/Cloudinary verdadeira, endpoint
  externo, configuração de publicação ou dados reais.
- Backup protegido, `main`, assinaturas, APK/AAB, OTA e Play
  Console permanecem intactos.

`productionIntegrated=false`;
`firebaseAdminSdkValidated=false`;
`realCloudinaryValidated=false`;
`playDeletionCompliant=false`.

A issue #72 continua aberta; a implantação do portal HTTPS e a
exclusão de dados reais devem ser discutidas numa revisão separada.

Referências técnicas:
- https://firebase.google.com/docs/emulator-suite/connect_auth
- https://firebase.google.com/docs/auth/admin/manage-users
