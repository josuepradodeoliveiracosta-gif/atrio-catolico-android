# Átrio Católico — portal público de solicitação e pré-voo de exclusão

Preparação: 31/10/2026. Proposta depende da **PR #73** e da issue #72.
**Não há página pública implantada, exclusão de contas ativada nem domínio de produção configurado nesta etapa.**

## O que está funcional no código, após configuração e implantação aprovadas

1. Portal estático e responsivo em `cloudflare/account-deletion-portal/public/`, adequado para Cloudflare Pages e acessível mesmo sem o APK instalado.
2. Login do titular pelo **Firebase Authentication Web (e-mail/senha)**, que já é o método usado pelo aplicativo; recuperação de senha pelo próprio Firebase Auth.
3. Sessão de autenticação **apenas em memória**, sem armazenar tokens ou senha em localStorage. Não há analytics.
4. Consulta sempre do servidor ao documento `account_deletion_requests/{uid}`; registra uma única solicitação com `status=requested`, `source=web`, `requestedAt=serverTimestamp()`. O Firestore confere o ID token e aplica as mesmas regras por UID do aplicativo.
5. Proteções de navegação: CSP, sem scripts inline, HTTPS nos endpoints Firebase, anti-clickjacking, no-store e no-referrer; não inclui dados pessoais na URL nem pedidos anônimos em nome de terceiros.
6. Informações públicas explicam que **pedido recebido ≠ conta excluída**.

**O formulário ainda não pode receber solicitações reais enquanto não for implantado e testado.**

## Gerar o portal (não publicar automaticamente)

Criar um aplicativo do tipo **Web** no projeto Firebase correto `atrio-catolico`, sem gerar chave de servidor, e configurar as seguintes variáveis de build **públicas** na Cloudflare Pages:

- `FIREBASE_PROJECT_ID=atrio-catolico`
- `FIREBASE_AUTH_DOMAIN=atrio-catolico.firebaseapp.com`
- `FIREBASE_WEB_API_KEY` (API key Web pública do mesmo projeto Firebase)
- `FIREBASE_WEB_APP_ID` (identificador **Web**, não o Android)

As credenciais de Admin SDK e as chaves privadas **nunca** entram nessas variáveis. O validador impede build com valores ausentes ou de outro projeto.

Criar projeto Pages de forma controlada:
- Diretório do projeto: `cloudflare/account-deletion-portal`
- Comando de build: `npm run build`
- Diretório de saída: `dist`

Antes de usar o domínio escolhido, adicioná-lo aos **domínios autorizados do Firebase Authentication**. O nome e URL públicos ainda precisam ser definidos e testados pelo responsável. Não registrar URL inventada no Play Console.

## O processamento efetivo permanece bloqueado

`cloudflare/account-deletion-processor/src/plan.js` é apenas inventário de operações, exclusivamente para `demo-atrio-v11`. Rejeita `atrio-catolico`, recusa IDs falsificados, jamais chama Firestore Admin SDK, Cloudinary ou Firebase Auth e sempre retorna `deletionAuthorized=false`.

Antes de implementar o processamento de produção:

1. Definir identidade administrativa **dedicada e de privilégio mínimo** com credenciais de curta duração. O Guardião V2 proíbe propositalmente autenticação administrativa por chave de longa duração em produção: não reutilizá-la nem contornar esse bloqueio.
2. Implementar backend controlado que enumere **todas** as coleções e subcoleções Firestore, inclusive documentos referenciados por terceiros, posts, respostas, reações, menções, notificações, fotos Cloudinary e dados Firebase Authentication; validar as regras e a política de retenção.
3. Criar fila de trabalho idempotente com estados auditáveis (`requested`, `in_review`, `processing`, `completed`, `failed`), detecção de falha parcial, tentativas controladas e proteção de contas administrativas/fundador.
4. Garantir que a exclusão da identidade Firebase Auth ocorra **por último**, apenas após sucesso das outras operações; atenção: apagar documento-pai no Firestore não apaga automaticamente subcoleções.
5. Exigir confirmação administrativa e teste em emuladores com **duas contas fictícias** para assegurar que não se apaguem dados de terceiros nem se deixem registros órfãos.
6. Documentar prazo de atendimento, confirmação de conclusão, retenções justificadas e canal para quem perdeu acesso à conta (identificação deve ser verificada, sem expor e-mail em logs).
7. Somente depois de tudo isso e da política de privacidade pública, avaliar uso na Play Store.

## Evidências automatizadas

- `tests/security/account-deletion-request.test.mjs`: testam Firestore Emulator para app e web; terceiros não podem criar, ler nem alterar solicitações.
- `cloudflare/account-deletion-portal/tests/build.test.mjs`: configuração pública obrigatória, proteção de informações e build.
- `cloudflare/account-deletion-processor/src/plan.test.mjs`: execução dry-run sem mutações, restrita ao projeto de teste.
- `.github/workflows/account-deletion-web-ci.yml`: CI com Node.js, sem autenticação nem deploy.
- CI de segurança Firestore já existente continua cobrindo as regras.

## Limites da conformidade

A URL web é exigida pela Google Play para apps com criação de conta. **Código e testes não substituem** disponibilizar um endereço HTTPS acessível, executar realmente a exclusão quando solicitada e informar a política de privacidade. Por isso PR #73 e esta proposta permanecem **rascunhos bloqueados para produção**.

Referência oficial: https://support.google.com/googleplay/android-developer/answer/13327111


## Etapa de registro Firebase Web comprovada pelo titular — 31/10/2026

O Firebase Web App **`Atrio Catolico - Portal de Exclusao`** foi
cadastrado pelo responsável no Firebase `atrio-catolico` através do Termux
(`firebase apps:create WEB`). O comando `firebase apps:list WEB`
confirmou exatamente um aplicativo WEB cadastrado. A CLI também informou a
existência de um **site Firebase Hosting** com o nome do projeto; isso não
demonstra que o portal esteja publicado ou acessível nesse site.

A auditoria de índices encontrou em produção o override
`replies.createdAt` com todos os modos necessários e um modo adicional
`COLLECTION`, que deve ser preservado antes de qualquer futuro deploy.
A exportação de índices não comprova `READY`.

**Novo pré-voo no Termux (read-only):** clonar a branch rascunho de privacidade
em uma pasta distinta da PR #71 e executar:
```bash
cd ~
gh repo clone josuepradodeoliveiracosta-gif/atrio-catolico-android atrio-privacy-qa -- --branch feature/privacy-admin-write-freeze-emulator-20261031 --single-branch
cd ~/atrio-privacy-qa
node cloudflare/account-deletion-portal/scripts/termux-web-preflight.mjs
```
O programa usa exclusivamente `apps:list WEB` e `apps:sdkconfig WEB`
com projeto fixo, valida a configuração Web recebida sem imprimi-la, monta
o portal em diretório temporário e remove os arquivos ao finalizar. Não
registra a `apiKey` no Git, não hospeda, não autentica contas reais e
não envia pedidos. Se a pasta já existir, usar `git pull --ff-only` em
vez de clonar novamente; nunca usar `git reset --hard`.

**Continua bloqueado para produção:** publicação do site, domínio
autorizado no Firebase Auth, política de privacidade pública, executor
real com retenção e verificação de permissões dos Workers. O cadastro Web
sozinho não satisfaz a evidência `external_portal` nem autoriza Play.

## Site separado no Firebase Hosting — proposta sem publicação (31/10/2026)

A consulta real executada pelo titular `firebase hosting:sites:list --project atrio-catolico`
confirmou **um site padrão** `atrio-catolico`, com URL
`https://atrio-catolico.web.app`. A coluna App ID aparece vazia; isso
não demonstra uma falha de cadastro do Firebase Web App, que já passou
na validação de SDK, e **não significa que o portal esteja hospedado**.
O conteúdo atual do site padrão não foi verificado por inspeção HTTP.

**Decisão de segurança:** preservar `atrio-catolico` sem deploy ou alteração
de configuração e propor um segundo site de Hosting dedicado à exclusão
de contas. A existência do site secundário não habilita o portal nem substitui
um backend seguro de exclusão.

A proposta de configuração encontra-se em
`cloudflare/account-deletion-portal/firebase.hosting.proposed.json`:
a configuração **não é** o `firebase.json` padrão do repositório; declara
somente `target=deletionPortal`, `public=dist` e reproduz os cabeçalhos
de segurança originalmente escritos em `public/_headers` para o
Cloudflare Pages, que não seriam aplicados automaticamente pelo Firebase
Hosting. O teste `tests/firebase-hosting-config.test.mjs` exige isolamento
do alvo e preservação de CSP, no-store, anti-clickjacking e no-referrer.

**Somente após aprovação explícita de cadastro de um segundo site:**

```bash
cd ~/atrio-privacy-qa
firebase hosting:sites:create atrio-catolico-exclusao --project atrio-catolico
firebase hosting:sites:list --project atrio-catolico
```

O identificador `atrio-catolico-exclusao` é uma **proposta**, não um recurso
já existente; precisa estar globalmente disponível no Firebase. Se a criação
falhar por indisponibilidade, não repetir com um ID aleatório nem tocar no
site padrão sem revisar o planejamento. Criar um site vazio não publica
o formulário e não mexe no site padrão.

**Não executar ainda** `firebase target:apply`, `firebase init`,
`firebase deploy` ou `firebase hosting:channel:deploy`. Mais adiante,
um alvo dedicado `deletionPortal` poderá ser vinculado ao ID que realmente
for registrado, mas somente depois de validar a política de privacidade,
o tratamento de pedidos, Auth e os riscos de retenção. Nem a URL do site
padrão nem a do secundário podem ser informadas à Play como portal de
exclusão operacional antes disso.

## Cadastro do site exclusivo confirmado no Termux — 31/10/2026

A segunda consulta real fornecida pelo titular mostrou **dois sites no mesmo projeto**:
- site padrão, preservado: `atrio-catolico`, URL `https://atrio-catolico.web.app`;
- site secundário criado: `atrio-catolico-exclusao`, URL
  `https://atrio-catolico-exclusao.web.app`.

**Não houve deploy do formulário no site secundário.** O endereço reservado
não comprova que os pedidos de exclusão estejam disponíveis, nem que o
Firebase Authentication reconheça a origem como domínio autorizado.

O alvo isolado está registrado **somente** na pasta de trabalho do portal:
`cloudflare/account-deletion-portal/.firebaserc`, com
`deletionPortal -> atrio-catolico-exclusao`. O arquivo de configuração
`firebase.hosting.proposed.json` exige esse alvo e não seleciona o site
padrão. O `firebase.json` da raiz do repositório continua intocado.

Verificação segura, sem gravar em Firebase e sem publicar site:

```bash
cd ~/atrio-privacy-qa
git pull --ff-only origin feature/privacy-admin-write-freeze-emulator-20261031
node cloudflare/account-deletion-portal/scripts/termux-hosting-target-preflight.mjs
```

O pré-voo compara o destino local com os IDs remotos via
`firebase hosting:sites:list --project atrio-catolico --json`, bloqueia
uma associação que aponte para o site principal e valida cabeçalhos CSP.
Nada faz deploy ou ativa autenticação ou exclusão. **Não executar**
`firebase deploy`, `firebase target:apply`, `hosting:channel:deploy`
ou `firebase init` nesta etapa. Os testes fechados permanecem bloqueados.
