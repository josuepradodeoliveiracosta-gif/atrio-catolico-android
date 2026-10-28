# Três bots de QA — exclusivamente ambiente de testes

Clara, Miguel e Lúcia são três **identidades simuladas** usadas para verificar o funcionamento do Átrio Católico e as regras reais do Firestore em emulador local (projeto Firebase de demonstração `demo-atrio-v11`). **Não são contas de produção** e não aparecem no perfil do fundador nem na comunidade pública.

## Perfis e responsabilidades

- **Clara (BOT DE TESTE):** publica uma discussão, recebe avisos e marca uma notificação como lida.
- **Miguel (BOT DE TESTE):** responde na discussão e envia aviso de resposta no mesmo batch. Tenta acessar informações privadas e alterar discussões de terceiros; as regras devem rejeitar.
- **Lúcia (BOT DE TESTE):** responde, simula denúncias e verifica bloqueios contra identidade falsa e privilégios administrativos.

As três identidades executam operações como **usuários autenticados distintos**, por meio do SDK do Firebase contra o **emulador**. O teste cobre permissões de perfis, publicação, respostas, notificações internas, relatórios e detecção por regex de CPF fictício. Também verifica que a conversa e seus dados permanecem íntegros. Não é necessário um administrador do app para iniciar o teste.

## Execução e resultados

A suíte `tests/security/three-bots.test.mjs` roda junto com os testes de segurança:

```sh
cd tests/security
npm ci
npm test
```

O comando prepara as regras e executa os testes no emulador Firestore. A rotina também integra o job **Regras de seguranca Firestore** da workflow `.github/workflows/selos-ci.yml`, automaticamente em PRs para main, ou manualmente no GitHub Actions pela opção **Run workflow**, sem adicionar controles ao aplicativo.

O relatório de terminal mostra **PASS BOT-QA** para cada cenário e termina com JSON incluindo `productionWrites: 0`, `realAccountsCreated: 0` e contagem de verificações. Qualquer falha devolve código não-zero e marca o job em vermelho; não publica nada na comunidade real.

## Segurança, limites e escopo

- O antigo botão de criação no perfil fundador, o arquivo `AdminTestBotsPanel.kt` e a rota `POST /test-bots/provision` foram removidos. O Worker não precisa mais do escopo OAuth Identity Toolkit para administrar contas Firebase Auth.
- O sinalizador `TEST_BOTS_ENABLED` não tem uso no código atualizado e deve permanecer **desabilitado**, ou ser retirado da configuração ativa do Worker.
- Nenhum destes testes executa o app Android em um aparelho nem mede entrega real de Push FCM. O comportamento do Push no backend é verificado por outros testes unitários. Para testes E2E com três celulares, seria necessário infraestrutura adicional de dispositivos e contas de teste separadas.
- Não há bots publicando mensagens a cada hora no ambiente real, respostas automáticas em discussões de usuários, nem perfis falsos que se passam por humanos. Todo conteúdo simulado é isolado e etiquetado como teste.
- O teste de CPF valida a regra local `classifyGuardiao`, **não prova** recebimento de eventos pelo Cloudflare em produção. O problema anterior de detecção no APK exige depuração separada.

## Bots sob demanda na comunidade oficial (estrutura da próxima versão)

A comunidade oficial poderá receber uma conversa **claramente identificada como simulação** apenas quando o fundador solicitar uma sessão nesta conversa. A arquitetura utiliza:

- Cloudflare Queue privada `atrio-qa-manual-v19`, sem Cron e sem endpoints HTTP de ativação.
- Mensagem `{kind:"manual_chat_qa_v1",requestId:"...",createdAt:"..."}` enviada somente quando houver uma nova autorização explícita nesta conversa.
- O Worker usa três **perfis de serviço identificados como bots** (Clara, Miguel e Lúcia), escreve uma única discussão, duas respostas e dois avisos internos entre os próprios bots, e registra a execução em `qa_bot_runs/{requestId}`.
- Cada gravação verifica `exists:false` no commit atômico do Firestore. Reenviar o mesmo `requestId` não duplica publicações.
- Os textos de demonstração não contêm CPFs reais ou outros dados pessoais; o programa não responde a discussões de pessoas reais.
- Os perfis no Firestore **não representam três contas Firebase Auth com login**; a simulação de permissões de login continua ocorrendo no emulador Firebase.
- Não serão criadas interfaces ou botões no perfil do fundador, nem programação para execução espontânea.
- Nenhuma publicação deve ser efetuada durante a preparação da infraestrutura. Somente uma solicitação posterior específica do usuário autoriza inserir a primeira mensagem na fila.

A infraestrutura nova não substitui nem desativa os testes automatizados do emulador. A fila do Cloudflare é distinta desses testes e serve apenas para realizar **uma sessão real solicitada**.

## Resultado do primeiro teste oficial — sessão qa_chat_20261026_01

- Um comando por Cloudflare Queue foi aceito e reprocessado para diagnóstico com o **mesmo identificador idempotente**.
- O Worker registrou `qa_profile_http_403`: o Firestore negou a criação de perfil de teste. A execução parou **antes do commit das discussões e respostas**, conforme o fluxo `executeQaCommand`.
- Nenhuma execução foi classificada como `created`.
- Medidas de contenção: `QA_MANUAL_ENABLED=false`, fila sem backlog, sem Cron. `GUARDIAO_ENABLED` e `PUSH_ENABLED` permaneceram `true`.
- **Não reativar** antes de corrigir a permissão de gravação para a identidade de serviço no projeto Firebase/Google Cloud (necessária `datastore.entities.create`) e de obter **uma nova autorização explícita do fundador nesta conversa** para uma sessão adicional.
- Evitar concessão desnecessária de papéis administrativos amplos. Se for preciso um papel predefinido, `roles/datastore.user` permite acesso de leitura e escrita e deve ser avaliado quanto ao alcance. Preferir serviço exclusivo de QA com permissões mínimas.

## Sessão autorizada e concluída: qa_chat_20261027_02

- O fundador concedeu uma **nova autorização explícita nesta conversa** após atualizar a permissão IAM do serviço `id-trio-push`.
- Mensagem única aceita na fila `atrio-qa-manual-v19` em `2026-10-27T00:46:57.966Z`.
- Resultado auditado no Cloudflare D1: **`qa_bots / created = 1`**, após `documents:commit` responder com sucesso. Isso confirma uma gravação atômica da discussão, duas respostas e dois avisos internos dos bots.
- ID da discussão gerada: `qa_qa_chat_20261027_02`; título: `[SIMULAÇÃO — BOT DE TESTE] Acolhimento na comunidade`.
- Em `2026-10-27T00:49:47Z`, Cloudflare confirmou: fila com **0 comandos pendentes**, **0 agendamentos**, `QA_MANUAL_ENABLED=false`, `GUARDIAO_ENABLED=true`, `PUSH_ENABLED=true`, `GUARDIAO_AUTOHIDE_ENABLED=false`.
- Esta é **uma sessão única**, não autoriza novas execuções. Os perfis de bot não possuem login humano; o teste não comprova entrega Push a dispositivos reais nem funcionamento da interface Android.
- Os erros `qa_profile_http_403` registrados em sessões antigas continuam presentes no histórico D1, mas são anteriores à sessão bem-sucedida e não indicam falha atual.

## Evolução: três usuários reais Firebase Authentication (sem fingir ser humanos)

A próxima sessão manual da comunidade oficial usa **Firebase Authentication de verdade**, não gravações de conteúdo via IAM por uma conta de serviço.

- Clara, Miguel e Lúcia têm UIDs predefinidos `qa_clara_v19`, `qa_miguel_v19` e `qa_lucia_v19`; cada nome de exibição contém **BOT DE TESTE** e nenhuma conta possui privilégios administrativos, e-mail ou senha humana.
- **Somente quando uma sessão for pedida nesta conversa**, o Worker pode criar um JWT customizado para cada UID utilizando uma conta de serviço existente mantida em Secret no Cloudflare. A API `accounts:signInWithCustomToken` cria o usuário no Firebase Auth no primeiro login ou retorna o mesmo UID nos seguintes.
- O Worker verifica cada login via `accounts:lookup` e nunca registra o JWT customizado, o token de ID ou o token de renovação. Nenhuma credencial é exposta ao aplicativo ou ao fundador.
- Cada bot acessa o Firestore com **seu próprio Firebase ID token**, o que submete leituras e escritas às mesmas `firestore.rules` aplicadas a membros comuns. A conta IAM fica limitada ao marcador operacional `qa_bot_runs`.
- O plano básico cria perfis, uma discussão, duas respostas, dois avisos internos, uma curtida e um salvo. Campos `createdAt` usam `REQUEST_TIME` do servidor, respeitando `request.time` nas regras. Cada gravação valida a existência/identidade para permitir retentativa sem duplicar conteúdo.
- O resultado `created` só é registrado quando todas essas operações passam. Um marcador `started` indica execução incompleta e nunca pode ser anunciado como concluída. Identificadores são determinísticos por sessão.
- As contas são **usuários de verdade do Firebase Auth**, mas continuam sendo bots identificados e **não simulam toques na interface Android**. A interface tem testes instrumentados separados. Para afirmar que os bots navegam pelo APK online em emuladores é necessário um teste end-to-end com sessões Android, ainda não concluído.
- Nenhuma conta é criada pelo deploy. `QA_MANUAL_ENABLED=false` continua sendo o estado de repouso, sem Cron, sem UI de fundador e sem comandos na fila.
- A atualização de código ainda precisa de validação no Firebase real na próxima sessão explicitamente autorizada. A sessão concluída em 27/10, `qa_chat_20261027_02`, foi executada pelo mecanismo **antigo IAM** e não valida o fluxo Firebase Auth novo.

## Sessão autenticada na comunidade oficial — qa_real_auth_20261027_01

- O fundador solicitou nesta conversa que os três bots atuassem como **contas reais do Firebase Authentication**. Foi usada uma única sessão `qa_real_auth_20261027_01`, reenviada sob o **mesmo requestId** após correções de bugs; não foi gerada uma nova discussão a cada tentativa.
- Correção 1: `accounts:signInWithCustomToken` não fornece `localId`; a validação do UID passou a ser feita pelo endpoint `accounts:lookup` após emitir e receber um ID token.
- Correção 2: notificações antigas com ID fixo `qa_miguel` / `qa_lucia` impediam reutilização dos bots (HTTP 409). Agora os `replyId` e `notificationId` recebem um sufixo `requestId` único, mantendo `notificationId == replyId` exigido pelas regras.
- O Worker registra `qa_bots / created` ao concluir toda a execução: três identidades autenticadas com Firebase ID token individuais, discussão na conta de Clara, respostas e notificações de Miguel e Lúcia, curtida de Miguel e salvo de Lúcia; o marcador de execução passa a `created`.
- Histórico D1: `qa_bots / created` passou de **1 para 2** após a sessão autenticada. Os códigos antigos de erro permanecem no histórico.
- Os perfis ficam marcados **BOT DE TESTE**; ninguém ganha permissão de administrador, clero ou fundador.
- Após o teste, `QA_MANUAL_ENABLED=false`; Guardião e Push continuam ativos, com ocultação automática desligada.
- **Limite de validação:** foram exercitados Firebase Auth e Firestore como três usuários reais; não houve automação visual do aplicativo Android instalado em três aparelhos nem medição de entrega FCM. Testes instrumentados Compose são isolados e não devem ser confundidos com a sessão de produção.
- Para a próxima execução real, exigir **nova autorização explícita** do fundador nesta conversa.


## Política atual de disponibilidade — alteração solicitada em 27/10/2026

Por solicitação explícita do fundador, **não é mais necessário desligar os bots após cada sessão**. Em produção, `QA_MANUAL_ENABLED=true` indica que o consumidor privado da fila está pronto para receber um comando; **não autoriza execuções espontâneas**. Continuam proibidos disparadores Cron, agendamentos, respostas automáticas fora de escopo e telas de controle no perfil fundador.

- O disparo de cada sessão exige **pedido explícito do fundador nesta conversa**, traduzido manualmente em mensagem pontual na Cloudflare Queue `atrio-qa-manual-v19`. O Worker não escuta a conversa sozinho.
- Cada comando contém `kind=manual_chat_qa_v1`, `requestId` exclusivo e `createdAt` recente. O backend valida formato e frescor, registra execução e impede reaproveitamento que duplique discussões.
- Ao finalizar, a flag `QA_MANUAL_ENABLED` **permanece verdadeira**. Isso significa apenas disponibilidade contínua; fila vazia = sem ações. A autorização nunca é permanente para publicar.
- Desabilitar a flag novamente somente por solicitação, necessidade de manutenção, falha de segurança ou risco de abuso.
- Esta mudança **não** ativa testes visuais Android, distribuição de APK nem Push em dispositivos; a automação de tela e o uso real de três celulares permanecem limitados às verificações próprias.
- Validação realizada: Cloudflare `QA_MANUAL_ENABLED=true`, sem Cron, fila vazia, `GUARDIAO_ENABLED=true`, `PUSH_ENABLED=true` e `GUARDIAO_AUTOHIDE_ENABLED=false`.

## Compatibilidade com regras de denúncias da PR #35 — 28/10/2026

- Esta PR #15 permanece **em rascunho**; nenhuma regra, Worker ou APK v0.19 foi publicado por esta alteração.
- Regras de criação de `reports` agora exigem ID determinístico: `uid_post_postId` ou `uid_reply_postId_replyId`.
- O Android de desenvolvimento v0.19 usa esses IDs para posts/respostas e preserva `InstantPushRelay.report(reportId)` após escrita bem-sucedida.
- Os testes `moderation.test.mjs`, `three-bots.test.mjs` e `three-bots-extended.test.mjs` cobrem identificação, privacidade, repetição e permissões no emulador. A variante de regras da PR #15 mantém as condições adicionais do Guardião.
- Testes emulados não autorizam disparo de sessão oficial na Cloudflare Queue nem provam notificações FCM recebidas no aparelho.
- **Atenção:** a PR #15 usa versionCode 25 (v0.19.0), número já utilizado pelo release oficial 0.18.1. Antes de qualquer futura integração ou APK release, corrigir essa numeração e revisar compatibilidade.

## Sincronização de código com main — 28/10/2026

- PR #15 permanece isolada e não publica APK, Worker ou regras.
- O módulo Android foi mantido com os recursos de v0.19.0, agora usando `versionCode 26` após a release 0.18.1 (25).
- As regras adicionais do Guardião e a deduplicação da PR #35 coexistem no ramo de desenvolvimento.
- CI em `feature/push-gratuito-cloudflare-v0190` valida regras, Android e interface no emulador local; aprovação não equivale a teste real no APK de produção.

## Diagnóstico de registro FCM — 28/10/2026

- Na versão **0.18.1**, a falha de cadastro do celular aparece como erro genérico; sem instalar versão posterior não é possível concluir se falhou token, Firestore ou inscrição em comunicados.
- A PR #15 v0.19.0 agora informa **Etapa 1/3** (obter token FCM / Google Play), **Etapa 2/3** (registrar token no Firestore) ou **Etapa 3/3** (inscrever nos comunicados).
- Antes desta correção, a falha na inscrição nos comunicados era mostrada incorretamente como erro do serviço FCM da etapa 1.
- As mensagens usam categorias fixas e nunca exibem token, UID, credenciais ou detalhes brutos da exceção. O teste unitário verifica todas as categorias.
- O recurso permanece **somente na PR #15**. Não foi instalado APK no telefone, nem publicado Firestore/Cloudflare. O backup não é alterado.
