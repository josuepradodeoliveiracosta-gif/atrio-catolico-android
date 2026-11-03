# Átrio Católico — backend privado de consulta (candidato não implantado)

**Status (03/11/2026): implementação para revisão na PR #71; NÃO há serviço real,
conta IAM, permissão ou endpoint implantado. Nenhum dado é excluído.**

## Entrega

O módulo \`cloudflare/account-deletion-audit/src/private-read-runtime.js\`
liga os componentes já testados: Firebase Admin para verificação de
identidade/roles do fundador, leitura REST estritamente enumerada do
Firestore e o diagnóstico conservador de exclusão. O módulo exporta uma
única operação \`inspect({uid,idToken})\` e **não abre porta, não cria API
pública, não tem rotas de escrita nem inicializa credenciais**. O objeto
de Firebase Admin deve ser fornecido por um servidor privado e tanto o
Auth quanto o Firestore devem pertencer ao mesmo aplicativo Admin
do projeto \`atrio-catolico\`. O adaptador de Firestore Admin deve expor
\`{app,collection: collectionName => getFirestore(app).collection(collectionName)}\`.

As etapas de ingresso previstas, na ordem, são:

1. Exigir processo Cloud Run com \`K_SERVICE=atrio-privacy-review-internal\`,
   \`K_REVISION\` válido e \`GOOGLE_CLOUD_PROJECT=atrio-catolico\`.
   Recusar credenciais estáticas, emuladores e ativação de exclusão.
2. Consultar o metadata server Google, com cabeçalho \`Metadata-Flavor\`,
   e exigir a conta de serviço dedicada
   \`atrio-privacy-reader@atrio-catolico.iam.gserviceaccount.com\`
   (nome **proposto**, ainda não criado ou validado).
3. Validar token do fundador com Firebase Admin
   \`verifyIdToken(idToken,true)\`, consulta Auth atual,
   \`admins/{uid}\`, \`app_config/founder\` e ausência de congelamento.
4. Somente depois da autorização, obter um OAuth temporário da
   credencial Google do mesmo Admin SDK, exigir validade residual e
   realizar exclusivamente consultas Firestore REST já permitidas
   (\`GET\`, \`:runQuery\` e \`:listCollectionIds\`). Revalidar acesso
   antes e depois de **cada** requisição, confirmar novamente o pedido
   original e retornar apenas contagens e pendências.
5. Não confiar em contagens como inventário global nem converter
   o diagnóstico em autorização para exclusão ou aprovação da Play.

## IAM a conferir ANTES de qualquer futura implantação

A conta de serviço deve ser **exclusiva** para consultas e, após
auditoria da política efetiva (incluindo herança, grupos e condições),
possuir apenas as permissões necessárias. Papéis a avaliar:

- \`roles/datastore.viewer\` — leitura de entidades e consultas Firestore.
- \`roles/firebaseauth.viewer\` — \`firebaseauth.users.get\` para
  verificar sessão e estado da conta.

**Não** conceder \`roles/datastore.user\`, \`roles/datastore.admin\`,
\`roles/firebaseauth.admin\`, Editor, Owner, funções de exclusão,
Cloudinary, D1 ou privilégios de token impersonation. A presença do
endereço de serviço no metadata server **não valida** quais papéis IAM
foram realmente atribuídos. O código marca
\`readOnlyIamRolesIndependentlyVerified:false\` por esse motivo.

O serviço Cloud Run futuro deve ser protegido pelo **IAM Invoker**
(\`--no-allow-unauthenticated\`) e por um caller autorizado separadamente.
A operação \`inspect\` requer também login Firebase válido do fundador,
mas **token Firebase não substitui a autenticação do invocador Cloud Run**.
Um cliente Android NÃO deve chamar o serviço diretamente com um token
Firebase ou receber tokens de acesso Google. Definir ingress, egress,
logging sem PII, limites por solicitação e o chamador servidor-servidor
antes de criar uma rota de produção.

Fontes oficiais para conferência:
https://docs.cloud.google.com/run/docs/authenticating/service-to-service
https://docs.cloud.google.com/iam/docs/roles-permissions/firestore
https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth

## Testes incluídos

A suíte Node já existente valida bloqueio por identidade errada do
runtime, identidade do fundador revogada, papel administrativo
revogado durante uma leitura, credencial com expiração curta,
SDK de projeto divergente e ausência de operações destrutivas. A
infraestrutura e as respostas de rede são **simuladas** nestes testes.
Nada verifica por si mesmo uma conta IAM existente, nem comprova um
endpoint Cloud Run real. A CI deve continuar sem credenciais reais.

## Bloqueios restantes

A integração com Cloud Run real, IAM mínimo comprovado, invocador
autorizado, auditoria externa de Auth/Cloudinary/D1/FCM, plano de
retenção aprovado, coordenação de escrita e processamento destrutivo
idempotente permanecem pendentes. A política de privacidade, os
Termos da Comunidade, as páginas HTTPS e as evidências para a Play
também não são considerados homologados.

**Não publicar nem aplicar alterações IAM sem aprovação explícita.**
