# #355 · Caixa de Conversas com descoberta em QA local

- Base Android: #361 em `6891fa8b156b47c03dec162ca0cd1c477ce3cd93`.
- Contrato e handler: #359 em `d8e0b122ec2296e086e152333886ff2c39229f4b`.
- Compose navega uma página por vez, com cursor opaco e encerramento em `nextCursor=null`. Busca e ordenação se aplicam à página aberta.
- O cliente distingue HTTP 200 vazio, 403 e falha de serviço. Em falha, limpa a página e uma nova tentativa começa da primeira página. A caixa descarta a resposta se a sessão mudar, inclusive em novo login com o mesmo UID. A troca de rede e a alteração de bloqueios observados invalidam a página. A página visível é revalidada a cada 10 s.
- A descoberta usa o ID token da sessão, sem UID nos parâmetros, via `127.0.0.1:8091` no `qaGeral` com opt-in. O destino conhecido mantém o índice por par e a abertura de conversa continua a verificar o documento no servidor. Para homologar histórico e bloqueio, componha também a #352 com a #357.

## Evidência do consumidor

- JVM: 11 testes em `AtrioInboxDiscoveryTest` e `AtrioPeerInboxPolicyTest`.
- Smoke HTTP com o cliente Kotlin e handler real de `d8e0b122`, Auth/Firestore Emulator `demo-atrio-v11` e fixture abaixo. Clara percorreu 20 + 20 + 3 itens únicos com cursor final nulo. Miguel recebeu 200 vazio e 403 ao usar cursor alheio. Lúcia recebeu 503 simulado. Uma resposta 200 de Clara foi descartada após troca para Miguel, antes de publicar no estado.
- A verificação de Auth do servidor de teste consulta o Auth Emulator local. O smoke usa a projeção e as transações do Firestore Emulator. O roteiro de instrumentação abaixo cobre Compose no emulador Android.

## Roteiro para o Chat 5

Compile o candidato em checkout efêmero, com os dois SHAs exatos e a proteção da #352. Use os mesmos preparos do runner `scripts/run-qa-android-emulator.sh` para isolar as configurações do APK, instalar as dependências e iniciar Auth/Firestore Emulator com o projeto `demo-atrio-v11`. Carregue as Rules compostas da árvore candidata. Use uma sessão limpa dos emuladores para a fixture.

Em outro terminal, na raiz do checkout composto:

```bash
cd tests/security
FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
node serve-inbox-discovery-android-qa.mjs
```

Com o emulador Android conectado e o host da fixture pronto, na raiz do checkout preparado:

```bash
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8089 tcp:8089
adb reverse tcp:8091 tcp:8091
ATRIO_QA_GERAL_BUILD=1 ATRIO_QA_FIREBASE_PROJECT=demo-atrio-v11 \
ATRIO_QA_INBOX_DISCOVERY=1 gradle :app:testQaGeralUnitTest :app:connectedQaGeralAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=br.com.atriocatolico.AtrioInboxDiscoveryEmulatorUiTest
```

Registre HEAD, árvore, variante e execução do teste focal e dos três bots da composição vigente. A fixture é descartável e usa contas e conversas fictícias. O endpoint do backend segue fechado fora deste ensaio.
