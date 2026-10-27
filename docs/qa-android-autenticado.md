# Próxima fase — QA Android autenticado com Clara, Miguel e Lúcia

## Objetivo

Validar o caminho **Android UI → Firebase Authentication → Firestore** usando três contas identificadas como `BOT DE TESTE`, sem dados pessoais e **sem conectar ao projeto de produção**. Esta fase é diferente dos testes de operações administrativas no servidor e dos testes do feed de demonstração local.

## Cenário E2E implementado

Arquivo: `app/src/androidTest/java/br/com/atriocatolico/ThreeBotsAuthenticatedAndroidUiTest.kt`.

1. O laboratório Android configura `demo-atrio-v11` como projeto Firebase **exclusivamente** em build debug, apontando Firebase Auth para `10.0.2.2:9099` e Firestore para `10.0.2.2:8089`.
2. Clara toca em **Criar conta**, informa nome público `Clara (BOT DE TESTE)`, e-mail descartável `qa.invalid` e senha exclusiva **do emulador**; publica discussão pelo botão do próprio aplicativo.
3. Clara sai tocando em **Sair da conta**. Miguel se cadastra e abre a discussão de Clara, responde pelo botão da tela e sai.
4. Lúcia se cadastra, entra na discussão, responde e sai.
5. Clara entra novamente pelo formulário real de login, consulta as duas notificações internas criadas pelos comentários de Miguel e Lúcia, e toca em **Notificações**.
6. O teste consulta documentos no **Firestore Emulator** para confirmar que as operações acionadas pelos toques foram realmente persistidas, em vez de apenas verificar textos na tela.

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
