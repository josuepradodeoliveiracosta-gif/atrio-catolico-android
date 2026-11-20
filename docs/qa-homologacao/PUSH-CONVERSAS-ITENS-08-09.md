# Átrio Conversas · QA dos itens 08 e 09

[Critérios e decisão da coordenação](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/199#issuecomment-7030050879).

## Identidade, admissão e versão

O ensaio Android usa o build type local `qaGeral`, pacote
`br.com.atriocatolico.qageral`, código 37, versão `0.19.10-qa-geral`,
sem Google Services remoto. A admissão usa Firestore Emulator no
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

O Worker de Conversas da #358 fixa `atrio-catolico-qa-geral`. Ele segue
como referência dos controles de orçamento e revogação. Sua composição
carece da mesma admissão das Rules do piloto no projeto `qa-general`.
O manifesto revisável deve fixar projeto, banco, App ID, Ruleset e SHA,
Worker e SHA, modo etário e identidade da rodada. Proposta de modo
legado `eligible / 2026-11-18plus-qa-v1`, com validação dos dois lados e
admissão vigente, sem reaproveitar autorização anterior por ausência de
registro. Chat 2 deve fechar os negativos de revogação, expiração,
exclusão/readmissão e bloqueio, incluindo destinatário, antes da reserva
D1 e antes de cada envio. O ensaio deste patch cobre a lista de contas
com o relay existente. Ainda falta repetir a matriz com o Worker de
Conversas, os mesmos documentos e a composição final.

[Paridade do Chat 2](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/200#issuecomment-7025224643) ·
[Auditoria do Chat 4](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/358#pullrequestreview-5985117653)

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

Os testes usam callbacks fictícios para exibir e navegar. Falta integrar
o receptor, o leitor autorizado de pendências, a notificação de sistema e
a navegação do APK para executar o fluxo em Android. O código-fonte atual da
`main` aceita os tipos legados do relay de navegação no QA remoto. No
contrato atual o sinal genérico não ingressa no fluxo de Conversas.
Os testes JVM documentam o candidato e ficam fora do APK.

| Item | Evidência complementar |
| --- | --- |
| 08 · Permissão concedida | Após a integração em QA, testar aviso genérico e toque com conta certa no Android. Na janela autorizada de entrega real, registrar a correlação de mensagem fictícia e alerta em segundo plano, app fechado e tela bloqueada, descrevendo o estado exato do processo. Comprovar a conversa correta e a rechecagem do acesso ao tocar. |
| 09 · Permissão negada | Testar a permissão de sistema negada, observar ausência de alerta e abrir manualmente a mesma mensagem com a conta destinatária. Preservar a evidência da versão, configuração, sessão, permissão e resultado. |
| Troca, repetição e revogação | Portar as negativas para o receptor e o toque reais com FCM injetado em QA. Conferir cache/offline, sinal tardio/repetido, logout, volta do mesmo UID e revogação no intervalo entre exibição e toque. |

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

No mesmo checkout, inicie o Firestore Emulator local no projeto
`demo-atrio-v11` e aponte ao endpoint loopback da instância de teste:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 \
  node --test tests/security/qa-conversation-push-admission.test.mjs
```
