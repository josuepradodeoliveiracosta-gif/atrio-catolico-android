# Privacidade — fanout de Push com autorização atômica (QA)

Continuação **na PR #98 consolidada**, em 31/10/2026. Sem deploy.

## Lacuna descoberta

`writeThreadNotices` no Push Worker envia um único
`documents:batchWrite` a vários `users/{uid}/notifications/{id}`.
O protótipo anterior da barreira admitia um ticket representando
`actorUid` e **apenas um** `recipientUid`. Essa autorização
seria incompleta caso um batch incluísse mais pessoas.

## Alteração nesta etapa (apenas QA)

- `qa-privileged-write-barrier.js`: o tipo `push_thread_notice`
  aceita, além do escopo unitário legado, o escopo
  `{actorUid,recipientUids}` com **todas** as contas afetadas.
  O esquema SQLite continua aceitando **somente duas identidades
  fictícias**. O ticket é admitido numa única instrução SQL, para
  não conceder permissão parcial quando um destinatário está
  `draining` ou `frozen`.
- `qa-push-fanout-gate.js`: calcula o escopo diretamente do evento,
  impedindo que um chamador esqueça de incluir um destinatário.
  Executa o **helper verdadeiro** `writeThreadNotices`, porém
  intercepta todas as chamadas de rede e aceita somente um
  transporte fictício de `batchWrite` para destinos e caminhos
  de fixture. Requer `ATRIO_PRIVILEGED_QA_ONLY=true`.
- `qa-push-fanout-gate.test.js`: admite um batch de duas pessoas
  atômica e verificavelmente, nega qualquer batch com ator ou
  destinatário congelado, permite à segunda conta operar quando
  independente, mantém os tickets durante operações em trânsito,
  recusa falsos recibos e trata falha parcial/timeout como resultado
  incerto que impede concluir o congelamento.

## Critério de segurança

O ticket é liberado **somente se a verificação independente** atesta
cada destinatário fictício. Respostas parciais ou ambíguas mantêm
a operação aberta; se uma conta inicia o freeze durante a requisição,
não é possível finalizar o freeze até a reconciliação da operação.

**NÃO afirmar proteção da produção:** a função ativa do Push Worker
continua sem integração obrigatória com a barreira. O teste cobre
**no máximo duas contas fictícias**, não tópicos/FCM, paginação de
destinatários reais, filas, retries ou os outros caminhos privilegiados
do Avatar/Guardião. Faltam desenho de tickets persistentes multi-cliente,
IAM, proteção de escritores em todos os Workers, retenção e portal HTTPS
operacional antes de autorizar exclusão de pessoas reais.

`productionIntegrated=false`; `safeToExecuteDeletion=false`.
Nenhuma alteração na `main`, produção, backup protegido, assinatura
Android, OTA, Play Console ou APK/AAB. Issue #72 permanece aberta.
