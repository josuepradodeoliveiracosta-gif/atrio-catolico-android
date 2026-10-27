# QA Android autenticado com Clara, Miguel e Lúcia

## Objetivo

Validar o caminho **Android UI → Firebase Authentication → Firestore** usando três contas identificadas como `BOT DE TESTE`, sem dados pessoais e **sem conectar ao projeto de produção**. Esta fase é diferente dos testes de operações administrativas no servidor e dos testes do feed de demonstração local.

## Cenário E2E implementado

Arquivo: `app/src/androidTest/java/br/com/atriocatolico/ThreeBotsAuthenticatedAndroidUiTest.kt`.

1. O laboratório Android configura `demo-atrio-v11` como projeto Firebase **exclusivamente** em build debug, apontando Firebase Auth para `10.0.2.2:9099` e Firestore para `10.0.2.2:8089`.
2. Clara toca em **Criar conta**, informa nome público `Clara (BOT DE TESTE)`, e-mail descartável `qa.invalid` e senha exclusiva **do emulador**; publica discussão pelo botão do próprio aplicativo.
3. Clara sai tocando em **Sair da conta**. Miguel se cadastra e abre a discussão de Clara, responde pelo botão da tela e sai.
4. Lúcia se cadastra, entra na discussão, responde e sai.
5. Clara entra novamente pelo formulário real de login, consulta as duas notificações internas criadas pelos comentários de Miguel e Lúcia, toca em **Notificações** e em **Marcar todas as carregadas como lidas**; o teste confirma `read=true` nos dois documentos do servidor.
6. O teste consulta documentos no **Firestore Emulator** para confirmar que as operações acionadas pelos toques foram realmente persistidas, em vez de apenas verificar textos na tela.

## Cenários adicionais de perfil e denúncia

- **Perfil e selo:** Clara se cadastra, edita a apresentação e salva pela tela; o teste consulta o servidor para confirmar a biografia. Depois abre os selos, seleciona Leiga e confirma `badges/{uid}.lay=leiga`.
- **Denúncia:** Clara publica conteúdo sintético; Lúcia entra com sua própria conta e denuncia a discussão pelo formulário. O teste aguarda a confirmação da interface após a escrita e verifica que o post original continua existindo, com corpo e autoria preservados. Não concede acesso administrativo a Lúcia para ler denúncias privadas.
- **Carregamento:** abrir uma discussão aguarda o snapshot do feed, além da presença do contêiner. O cenário de denúncia também aguarda o retorno ao feed após publicar antes de sair da conta.

## Defesa contra escrita fora do laboratório

- O teste é interrompido se `BuildConfig.DEBUG` for falso ou `BuildConfig.PUSH_RELAY_URL` não estiver vazio.
- Uma única aplicação Firebase com ID de projeto `demo-atrio-v11` é aceita; projeto diferente aborta a execução.
- O script `scripts/run-qa-android-emulator.sh` remove `google-services.json` apenas da VM efêmera de CI e inicia os dois emuladores antes de instalar o APK.
- O aplicativo ignora a inicialização de Push e tarefas de notificação externas quando está em modo debug com projeto `demo-atrio-v11`.
- O tráfego HTTP em debug é permitido apenas ao host `10.0.2.2`; o manifesto e configuração de rede de produção permanecem sem liberação de HTTP.
- Este cenário não emite comandos na fila Cloudflare e não cria contas, publicações ou notificações no Firebase de produção.

## Execução e limites

A workflow `.github/workflows/android-bots-ui.yml` roda os testes instrumentados em Android virtual; também conserva os testes Compose do modo demonstração. Os testes de regras Firestore e os cenários de servidor continuam nas próprias workflows.

**O que esta fase ainda não comprova:** login no Firebase oficial pelos três bots diretamente no APK de produção, recepção real de Push FCM em três aparelhos físicos, permissões de Android de um celular específico, câmera ou outros recursos não implementados no app. Não confundir uma suíte de emulador que passou com certificação integral de todas as funções reais.

A PR permanece em rascunho até aprovação e integração. Não instalar a suíte de instrumentação no APK oficial.

## Resultado validado — 27/10/2026

- Commit de código: `b743cb1d92f46136e0c6f537d984f7af87ab1b7d`.
- [Execução 40585821095](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/40585821095), job `122477922294`: **13 testes aprovados**, sem falhas ou testes ignorados.
- Grupos executados separadamente: 9 testes de demonstração, 3 cenários autenticados (cadastro/discussão/avisos; perfil/selo; denúncia) e 1 cenário de integração online com Firebase emulado.
- Também passaram as verificações de Android/Firestore, relay e versão nesse commit.
- O teste de denúncia confirma o aviso de sucesso da interface e a preservação do post; não valida revisão administrativa nem remoção pelo moderador. Não mede entrega FCM em aparelho físico ou funcionamento do APK conectado à produção.
- A correção desta retomada aguarda o snapshot do feed antes de abrir a discussão e o retorno ao feed antes de sair após a publicação do cenário de denúncia.
- PR #15 permanece em rascunho. Esta validação não publicou release, não alterou assinatura e não executou bots na comunidade oficial.
