# Átrio Católico — executor administrativo segregado (etapa QA)

Preparação de 31/10/2026, baseada na PR #94. **Somente no Firebase
Emulator; não há exclusão de contas em produção.**

## Alterações

O módulo `tests/security/qa-admin-executor.mjs` cria um fluxo
administrativo antes do runner de exclusão. Exige **pedido novo confirmado
no Firestore Emulator**, duas aprovações de papéis diferentes e uma
decisão explícita de retenção sem bloqueios **somente para fixture**.
O ID de trabalho e os revisores são predefinidos e fictícios.

O módulo `tests/security/qa-admin-owned-cleanup.mjs` substitui a
exclusão de IDs privados pré-cadastrados pela descoberta dos documentos
existentes nas subcoleções de titular conhecidas:

- `users/{uid}/likedPosts`, `savedPosts`, `followedPosts`,
  `pushDevices` e `notifications`;
- `guardian_notices/{uid}/items`.

A listagem tem limites fixos (500 documentos por coleção e 2.000
no total); um resultado inesperado bloqueia a operação. Cada
`deleteDoc` sobre **Firestore Emulator** exige uma conferência
do lease antes e depois. Dados relacionais de outras contas,
publicações, moderação e retenções **não são apagados por esse
módulo**: permanecem na fase relacional e na auditoria do processo.

A reconciliação fresca da PR #93 e a checagem contra executor
obsoleto da PR #94 continuam sendo exigidas antes do Auth de
teste. A exclusão do Firebase Authentication e dos recursos
Cloudinary continua simulada por `Set` em memória.

## Testes adicionais

1. Subcoleções privadas com IDs inéditos são apagadas no Emulator,
   e dados de `qa-delete-bob` permanecem intactos.
2. Solicitação ausente, revisão incompleta/forjada, UID trocado
   e retenção não revisada interrompem o processo antes dos efeitos.
3. Falha após limpar documentos privados e antes de registrar o
   checkpoint permite reiniciar sem apagar os dados do segundo usuário.
4. Variáveis que indicam credenciais Cloudinary reais bloqueiam o
   módulo em ambiente de QA.

A CI de privacidade existente cobre esses testes no Firebase
Emulator local.

## Garantias e lacunas

**Isolamento obrigatório:** `GCLOUD_PROJECT=demo-atrio-v11`,
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8089`, sem credenciais
de Firebase/Cloudinary de produção. Não foi criado endpoint
administrativo público, Worker de exclusão, migração de banco
ou configuração de deploy.

**Não há autenticação real dos administradores.** Os nomes das
aprovações são fixtures fixas e não equivalem a IAM, MFA ou
assinaturas auditáveis. O freeze de clientes ainda é simulado,
e os Workers ativos podem escrever fora das barreiras de QA.
Persistência do diário não prova atomicidade entre serviços.

A limpeza dinâmica trata apenas subcoleções **conhecidas**.
Coleções desconhecidas, referências cruzadas, backups,
retenção legal, mídia Cloudinary, FCM e Auth real exigem
integração adicional e revisão humana. Comportamento de escrita
em trânsito ainda requer coordenação/fencing do lado do
servidor, não só conferência antes de requisição.

## Próximas etapas antes de testes fechados Play

1. Validar a CI e inventariar todas as rotas de escrita.
2. Criar credenciais IAM segregadas, verificadores reais de
   identidade de revisores e auditoria persistente, sem
   reaproveitar credenciais de produção.
3. Homologar Firebase Auth Emulator, Firestore Emulator e
   simuladores HTTP/Cloudinary, incluindo falhas parciais.
4. Desenvolver barreiras de escrita operacionais sem bypass,
   retenção e executor remoto com idempotência verificada.
5. Implantar portal HTTPS de solicitação; concluir a issue #72
   e só então reavaliar a aprovação para Google Play.

**Estado:** `realAccountDeletionEnabled=false`,
`productionIntegrated=false`, `globalCoverageComplete=false`.
A PR deve permanecer em rascunho, sem integração à `main`.
APK, AAB, OTA, assinatura e **backup protegido** preservados.
