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
