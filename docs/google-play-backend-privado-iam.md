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


# Átrio Católico — Cloud Run administrativo privado (candidato, NÃO implantado)

**03/11/2026 · PR #71 · REVISÃO DE CÓDIGO APENAS.**
Não existe URL operacional, imagem assinada, conta IAM homologada ou exclusão real.
Nenhuma publicação na Play Console é autorizada por estes arquivos.

## O que já está preparado

- `cloudflare/account-deletion-audit/src/cloud-run-private-handler.js`: endpoint **único** `POST /v1/review` com corpo JSON estrito `{uid,idToken}`, tamanho máximo de 8 KiB, uma solicitação simultânea por instância, resposta sem cache, ausência de logs de tokens/UIDs e erros genéricos.
- `ops/cloud-run-private-review/server.mjs`: inicializa Firebase Admin com credenciais padrão **do ambiente Cloud Run** (nenhuma chave baixada) e conecta o diagnóstico exclusivamente de leitura. A inicialização é rejeitada se o ambiente não for o serviço Cloud Run com nome/projeto esperados.
- `ops/cloud-run-private-review/Dockerfile`: empacotamento candidato Node.js 22 não root. **Não** é artefato assinado nem aprovado para produção; o `npm install` do contêiner ainda precisa de lockfile reprodutível e análise de vulnerabilidades antes de build homologado.
- `ops/cloud-run-private-review/infra/main.tf`: modelo Terraform **não aplicado**, com conta de serviço dedicada e papéis de leitura Firestore/Auth, Cloud Run `INGRESS_TRAFFIC_INTERNAL_ONLY`, autenticação IAM Invoker obrigatória, um invocador serviço-a-serviço explícito, imagem de Artifact Registry por digest SHA-256 e no máximo uma instância sem mínimo. Proteção contra destruição e ausência de exposição anônima.

## Duas identidades independentes — não misturar tokens

1. **Chamador servidor-servidor:** o Cloud Run só deve aceitar uma identidade Google do *serviço chamador*, explicitamente autorizada com `roles/run.invoker`. Ela deve enviar um token OIDC Google assinado no header `X-Serverless-Authorization: Bearer <Google ID token>` (audience igual à URL do serviço). A autenticação é imposta **pelo Cloud Run, antes do processo Node**, e NÃO é comprovada pelo handler. O cliente Android nunca deve chamar esse serviço diretamente.
2. **Fundador:** o servidor chamador deve, após autenticar corretamente a pessoa em uma sessão privada, enviar o token Firebase da conta do fundador dentro do corpo JSON (não como header Google). O SDK Admin verifica assinatura/revogação, estado do usuário, `admins/{uid}`, `app_config/founder` e `account_deletion_freeze/{uid}`. O callback revalida o acesso antes/depois de cada consulta Firestore. Nenhum token Firebase é suficiente para escapar do IAM de invocador.

**Não há implementação neste commit do serviço chamador**. Ele precisa de avaliação separada de autenticação, consentimento, abuso, logging, escopo do usuário e autorização de acesso. O Terraform exige o e-mail dessa conta separada como variável obrigatória e proíbe usar a própria conta leitora como invocadora.

## IAM, imagem e deploy: homologação antes de qualquer ação

O Terraform define recursos **que só serão criados por um operador autorizado após aprovação explícita**. Revisar o projeto, as contas atuais, direitos herdados, políticas organizacionais e a fatura antes de executar `terraform plan` ou `apply`. Não conceder Editor, Owner, datastore.user/admin ou firebaseauth.admin. O papel `roles/firebaseauth.viewer` oferece consulta de Auth, **não** exclusão; `roles/datastore.viewer` oferece leitura Firestore, **não** mutação. A plataforma deve exigir Invoker IAM e ingresso apenas interno.

Antes de qualquer tentativa de implantação:
- concluir revisão jurídica e retenção, confirmar titularidade, publicar páginas HTTPS aprovadas;
- disponibilizar chamador autenticado próprio com OIDC Google e justificativa operacional;
- produzir imagem imutável e reprodutível com lockfile, dependências auditadas e digest verificado;
- revisar IAM real **no ambiente Google Cloud**, incluindo permissões efetivas de serviço e invocador e política para a equipe responsável;
- revisar limites de custo, privacidade do registro de acesso, mecanismos de contenção e reconciliação;
- executar testes integrados em ambiente descartável; repetir homologação de Auth, Cloudinary, D1 e FCM antes de qualquer executor real.

Não executar `docker build/push`, `terraform apply` ou criar IAM sem autorização. O serviço não possui operações de escrita ou exclusão: a saída conserva permanentemente `accountDeletionAuthorized:false` e `googlePlayReleaseAuthorized:false`.

## Verificação automatizada

A auditoria de privacidade Play já existente roda os testes Node do handler HTTP: valida rejeição de URLs/métodos não listados, payload grande, JSON inválido, campos extras, resposta contaminada, revogação na camada interna e vazamento de UID/token. Um teste estático inspeciona os invariantes de segurança do modelo Terraform. **Isso não substitui `terraform validate`, teste de Cloud Run IAM real, build de container ou teste de tráfego em produção**, todos pendentes.

Fontes oficiais:
- https://docs.cloud.google.com/run/docs/authenticating/service-to-service
- https://docs.cloud.google.com/run/docs/securing/ingress
- https://firebase.google.com/docs/auth/admin/manage-sessions
- https://firebase.google.com/docs/admin/setup


## Limites de custo e interrupção de consultas — 03/11/2026

A infraestrutura privada agora possui orçamento de **45 segundos por
diagnóstico**, **8 segundos por chamada de rede Firestore** e **até 320
leituras REST** por solicitação. O transporte continua limitado a
consultas Firestore permitidas. Quando o orçamento se esgota, a
operação é interrompida sem relatório parcial, exclusão ou aprovação.
O cliente HTTP também sinaliza o cancelamento da consulta se a
conexão for encerrada antes da resposta.

A verificação de identidade e as leituras são revalidadas antes e
depois das chamadas remotas. Esse orçamento reduz o risco de
varreduras ilimitadas e custos inesperados, mas **não garante o
cancelamento imediato de uma chamada Firebase Admin já iniciada**;
sua conclusão ainda deve ser tratada como não autorizada após o
cancelamento. Em caso de fonte muito grande, a análise deve seguir um
procedimento privado de paginação revisada, e não elevar
automaticamente o limite nem ignorar documentos pendentes.

A CI contém testes para interrupção após uma resposta, ausência de
novas leituras, rejeição de mais de 320 chamadas, propagação do sinal
de cancelamento e término de uma conexão HTTP abandonada. Nenhuma
leitura real, deleção, deploy, assinatura ou alteração IAM foi feita.


## Dependências e imagem reproduzível — 03/11/2026

O lockfile **verdadeiro** `ops/cloud-run-private-review/package-lock.json` foi resolvido
por `npm` em um runner GitHub Actions sem segredos e versionado após
conferência de `firebase-admin` **14.5.0**, integridades e manifesto. O
Dockerfile deixou de usar `npm install --package-lock=false` e agora exige
`npm ci --omit=dev --ignore-scripts`, preservando versões e integridade
das dependências. `Dockerfile.dockerignore` restringe o contexto do build
ao código necessário e não altera outros builds Android.

A workflow `private-cloud-run-lockfile-qa.yml` testa lockfile,
instalação limpa, auditoria de vulnerabilidades altas/críticas e
**docker build sem docker push ou deploy**. Um teste aprovado prova
somente que a imagem candidata é compilável no runner, não que foi
publicada ou homologada para dados reais. O resultado negativo mantém
a PR bloqueada até correção — não é permitido contornar a auditoria.

**Limitação relevante:** a base `node:22-alpine` é ainda uma tag
mutável. Uma imagem de entrega precisará de uma base fixada por digest,
SBOM, auditoria de dependências e digest imutável no Artifact Registry.
O Terraform já exige digest imutável no parâmetro de imagem. Não há
autorização para publicar contêiner, criar conta IAM ou implantar Cloud Run.


## Validação estática Terraform na CI

A workflow de QA do contêiner agora instala Terraform 1.14.6 e executa
`terraform fmt -check`, `terraform init -backend=false` e
`terraform validate`, sem credenciais Google e sem comandos `plan` ou
`apply`. O resultado confirma somente a validade do código e dos
atributos do provedor — **não** consulta permissões IAM reais, não
cria recursos no projeto e não valida a conectividade de Cloud Run.
O lock de provedor gerado deve ser versionado após revisão para impedir
mudanças silenciosas de versão entre builds.


### Provedor Terraform fixado após validação offline

O runner da CI instalou o provedor Google **7.46.2** e concluiu
`terraform fmt -check`, `terraform init -backend=false` e
`terraform validate` com sucesso. O arquivo
`ops/cloud-run-private-review/infra/.terraform.lock.hcl` agora
registra a versão escolhida e as verificações de integridade do
provedor; a CI passou a exigir `-lockfile=readonly`, impedindo
atualizações silenciosas. Isso valida **código de infraestrutura**,
não concede nem confirma permissões IAM no projeto real.
