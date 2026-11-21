# Átrio Conversas · QA dos itens 08 e 09

[Critérios e decisão da coordenação](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/199#issuecomment-7030050879).

## Identidade, admissão e versão

O ensaio Android usa o build type local `qaGeral`, pacote
`br.com.atriocatolico.qageral.celular`, código 37, versão `0.19.10-qa-geral`,
sem Google Services remoto. Exige `ATRIO_QA_GERAL_CELULAR_PILOT=1` e
`ATRIO_QA_CONVERSATION_NOTICE_LAB=1`, ambos em rede emulada. A admissão usa Firestore Emulator no
projeto fictício `demo-atrio-v11`, com `renderClosedPilotRules()`.
O verificador real do relay existente usa a identidade de projeto
`atrio-catolico-qa-general` no token sintético. A resposta do Auth é
simulada. A matriz verifica a lista exata de pares UID/e-mail verificado
e o acesso direto à mensagem do cenário fictício. Gates de abertura são
preenchidos exclusivamente no emulador para os casos positivos.

Para eventual rodada real, a composição a revisar usa
`atrio-catolico-qa-general`, banco `(default)`, o App ID registrado
para `br.com.atriocatolico.qageral.celular` e um novo build QA Geral
Celular. O APK 42 foi assinado com push desligado. Propõe-se `versionCode`
43 se estiver livre ao fechar a composição, com o certificado QA já
adotado para atualização do mesmo pacote. Chat 3 e Chat 5 devem confirmar o alvo antes do empacotamento.
A abertura da rodada depende de autorização específica do fundador.

O Worker de Conversas da #358 fixa `atrio-catolico-qa-geral`. A #383
ensaiou um candidato separado para `atrio-catolico-qa-general`, banco
`(default)`, modo `eligible / 2026-11-18plus-qa-v1`. O manifesto
revisável deve fixar também App ID, Ruleset e SHA, Worker e SHA e rodada.

As Rules do candidato fecham acesso cliente a `chatPushPending` e
`chatPushAdmission`. O APK de laboratório consulta `GET /notice` no Worker
por loopback. O Worker obtém o destinatário pelo token Firebase e revalida
o Auth atual dos dois participantes, a admissão, o 18+, o bloqueio,
a rodada e o evento. `GET /notice` e o envio compartilham essa verificação.
A resposta contém apenas identificadores do evento autorizado, com
`Cache-Control: no-store`. O caminho manual do chat usa as Rules de
Conversas e segue sua própria autorização.

Cada concessão administrativa registra uma `generation` nova e
`admittedAt` com hora confiável do servidor. O provisionamento vincula
a pendência à rodada e às gerações vigentes das duas contas, gravadas
como `senderGeneration` e `recipientGeneration`. O Worker relê os dois
registros e exige que o `createdAt` canônico da mensagem seja posterior
às duas admissões, com precisão de milissegundos. Readmitir uma conta
invalida o aviso anterior mesmo durante sua validade e impede regravar
uma pendência para a mensagem antiga. Documentos sem essas referências
são recusados. Na revogação, o serviço da #393 rota a geração na mesma
transação em que fecha a admissão. Uma intenção anterior é recusada com
HTTP 409. A restauração 18+ nas provas integradas usa uma fixture
privilegiada do emulador.

[Paridade do Chat 2](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/200#issuecomment-7025224643) ·
[Auditoria do Chat 4](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/358#pullrequestreview-5985117653)

Para restaurar elegibilidade 18+, grave primeiro a autorização em
`chatAgeEligibility/current`. A leitura manual volta pelas Rules. O Worker
exige que a última alteração desse registro para cada participante seja
estritamente anterior ao `admittedAt` de sua concessão de push. Qualquer
alteração posterior preserva o bloqueio dos avisos antigos. Uma nova
concessão explícita de push usa uma geração nova e exige uma mensagem
posterior à concessão. A consulta e a entrega usam a mesma checagem.

## Serviço administrativo

O serviço de administração é um handler Fetch separado do Worker. O host
administrativo deve fornecer a URL HTTPS do transporte verificado, Firebase
Admin Auth e Firestore do projeto `atrio-catolico-qa-general` no banco
`(default)`, e a allowlist de UIDs e capacidades somente do servidor.
O handler vem desativado. O Worker reserva `GET /notice` para o APK.

| Rota administrativa `POST /v1/qa/conversations/push/admin/…` | Corpo JSON | Capacidade |
| --- | --- | --- |
| `admit` | `uid`, `operationKey`, `expectedGeneration`, `expiresAt` | `manage_admissions` |
| `revoke` | `uid`, `operationKey`, `expectedGeneration` | `manage_admissions` |
| `publish` | `senderUid`, `recipientUid`, `conversationId`, `messageId`, `expectedSenderGeneration`, `expectedRecipientGeneration`, `expiresAt` | `publish_notices` |

Enviar o token do operador em `Authorization: Bearer` e `expiresAt` em ISO 8601
UTC com milissegundos. A identidade do operador vem da autenticação da #389 e
fica registrada nas operações e recibos. A publicação administrativa grava a
pendência no Firestore. A entrega continua sujeita aos gates do Worker, inclusive
`PUSH_ENABLED=false` durante o piloto fechado.

## Sinal e validação Android

O ensaio JVM modela um sinal somente de dados, com uma chave fixa e
janela proposta de até 60 s. O transporte carrega apenas um pedido de
atualização, sem texto, remetente, UID, identificadores de conversa
ou mensagem, tipo de evento ou contadores. O destino vem exclusivamente
de uma pendência individual, canônica, inédita e acessível retornada
pelo servidor. Cache, falha, destino divergente, pendência ausente ou
já lida e mudança de sessão descartam o resultado. No toque, uma nova
leitura do mesmo item e uma sessão inalterada precedem a navegação.
A permissão de sistema recusada impede o alerta e preserva a leitura
manual da mesma mensagem. O protótipo modela essa separação e a matriz
de Rules comprova a leitura da mensagem fictícia com a conta admitida.

O teste JVM exercita o modelo. Na instrumentação do Celular isolado, o
binder interno do SDK entrega um `RemoteMessage` ao `AtrioPushService`
não exportado. A entrada usa exatamente `signal=refresh` com TTL de até
60 s. O cliente consulta o mesmo Worker candidato com Auth e Firestore
Emulator por encaminhamento ADB. A fixture retém uma resposta para provar
que o aviso aguarda a consulta. O teste reconta a consulta no toque e
verifica o descarte após mudança de conta durante o GET. Com permissão negada,
o mesmo conteúdo é lido pela navegação manual sem exibir aviso.

O laboratório conserva `POST_NOTIFICATIONS`, desativa auto-init e registro
de FCM e remove a ponte de mensagens externas do Manifest. A versão para
uma rodada real ainda precisa ser composta e validada com autorização.

### Pré-voo do perfil HTTPS no Android Emulator

O perfil `ATRIO_QA_GERAL_CELULAR_RODADA43=1` exige a identidade registrada
do QA Geral Celular e a origem HTTPS aprovada da rodada. O ensaio
`ATRIO_QA_GERAL_CELULAR_RODADA43_FIXTURE=1` tem identidade fictícia e não
pode cadastrar um aparelho. O perfil HTTPS mantém apenas a entrada do SDK
protegida por `com.google.android.c2dm.permission.SEND` para receber FCM. O
serviço do aplicativo não é exportado; auto-init, tópicos e injeção do
laboratório permanecem desativados. O verificador do APK usa
`python3 -m scripts.qa_geral_celular_round43 metadata --notice-https` para
conferir identidade e manifesto e `proof --notice-https` para conferir
também assinatura, hashes e origem Git.

Com a conta fictícia verificada, o operador do aparelho habilita
**Receber avisos neste aparelho**. O app registra o token no documento
privado do próprio usuário, usando as Rules de QA já existentes. O token
é atualizado ao voltar ao app ou por callback do SDK; trocar de conta
exige invalidar o token anterior antes de cadastrá-lo para outra conta.
Ao tocar num aviso após o Android recriar o processo, o app usa um
comprovante local de uso único apenas para comparar a mensagem que o
servidor acabou de confirmar. Nenhum texto ou destino navegável fica no
comprovante. Um aviso expirado, de outra conta ou sem autorização é
ignorado.

Somente na janela especificamente autorizada para o FCM real, registrar
nas duas instâncias Android com Google Play services o mesmo APK assinado,
versão, Android e estado do piloto. Para o item 08, usar
uma mensagem fictícia inédita por cenário: segundo plano, tarefa
removida dos Recentes e tela bloqueada. Remover dos Recentes não equivale
a **Forçar parada** nas configurações do Android. Para o item 09, manter
o cadastro do aparelho e negar somente a permissão do Android; constatar
a ausência de aviso durante a janela combinada e abrir manualmente a
mesma mensagem. Para cada caso, anotar separadamente o aceite pelo FCM,
a entrada no serviço Android, a apresentação do aviso e a navegação.
Com a permissão negada, a ausência do aviso só comprova o item 09 se
a entrada no serviço também for observada. Os registros devem omitir
tokens, credenciais e conteúdo das mensagens.

| Item | Evidência complementar |
| --- | --- |
| 08 · Permissão concedida | Após a integração em QA, testar aviso genérico e toque com conta certa no Android. Na janela autorizada de entrega real, registrar a correlação de mensagem fictícia e alerta em segundo plano, app fechado e tela bloqueada, descrevendo o estado exato do processo. Comprovar a conversa correta e a rechecagem do acesso ao tocar. |
| 09 · Permissão negada | Testar a permissão de sistema negada, observar ausência de alerta e abrir manualmente a mesma mensagem com a conta destinatária. Preservar a evidência da versão, configuração, sessão, permissão e resultado. |
| Troca, repetição e revogação | Reexecutar as negativas com sinal injetado no laboratório. Conferir cache/offline, sinal tardio/repetido, logout, volta do mesmo UID e revogação no intervalo entre exibição e toque. A janela autorizada cobre o transporte real até o receptor protegido. |

O sinal pode revelar que houve atividade mesmo sem conteúdo, se a
revogação ocorrer entre a última leitura do Worker e o FCM. A decisão
sobre esse risco residual é anterior a qualquer abertura. O piloto
remoto e o push ficam desativados.

## Reprodução local

Em um checkout descartável sem arquivos Google Services, com Gradle
8.13, Java 17, SDK Android e as dependências Node fixadas no lock:

```bash
ATRIO_QA_GERAL_BUILD=1 gradle :app:testQaGeralUnitTest
```

A matriz de admissão e a matriz bilateral do Worker usam o Firestore
Emulator em loopback e simulam Auth, OAuth, D1 e FCM. Para executá-las:

```bash
cd tests/security
npm ci
node prepare.mjs
./node_modules/.bin/firebase emulators:exec --only firestore --project demo-atrio-v11 \
  'node --test qa-conversation-push-admission.test.mjs && node --test qa-conversation-push-pilot.test.mjs && ATRIO_383_REVERSE=1 node --test qa-conversation-push-pilot.test.mjs'
```
