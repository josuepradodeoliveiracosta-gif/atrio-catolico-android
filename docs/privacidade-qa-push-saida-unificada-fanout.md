# Privacidade — saída única de Push com fanout atômico (QA)

Continuidade da PR consolidada **#98**. Este módulo é **somente de
homologação**, não integra nem altera o Worker de produção.

## Problema

O adaptador QA `qa-push-outbound-gate.js` já verificava envios FCM
individuais, limpeza de dispositivos inválidos e notificações unitárias
do Worker verdadeiro. Entretanto, rejeitava completamente
`documents:batchWrite` com dois ou mais destinatários. O novo ensaio
`qa-push-fanout-gate.js` usava uma segunda barreira separada.

Para impedir regras diferentes para o mesmo tipo de operação, o **mesmo
adaptador de saída** passa a reconhecer lotes estritos de **até duas
contas fictícias** e reservar atomicamente todas as identidades
afetadas antes da primeira chamada HTTP falsa.

## O que foi testado

- A função verdadeira `writeThreadNotices` prepara um
  `documents:batchWrite` para Alice e Bob; os dois são incluídos no
  mesmo ticket SQLite, com o autor do evento.
- Uma conta `draining` ou `frozen` nega o **lote inteiro** antes
  de qualquer envio. A outra conta pode continuar recebendo um evento
  independente.
- Nenhum lote passa com destinatário desconhecido, UID duplicado,
  donos misturados, replyId/ postId divergentes, campos extras,
  outra coleção ou mais destinatários que o limite de QA.
- A resposta HTTP deve conter **exatamente um resultado por
  destinatário**, sem erro. A verificação externa injetada continua
  obrigatória; falso sucesso ou erro parcial mantém o ticket aberto
  para reconciliação, impedindo finalizar o freeze.
- A validação do destinatário ocorre no **payload real de saída**,
  não num identificador fornecido separadamente pelo chamador.

## O que esta etapa NÃO valida

- Não há implantação nem proteção automática do Worker real.
- IDs e token são fictícios e o transporte HTTP é simulado;
  não há FCM real, autenticação IAM ou Cloudflare real.
- Duas identidades fixas não são um fanout para centenas de membros.
- Não cobre topic broadcast, cron, filas, D1, moderação, múltiplos
  dispositivos nem todos os caminhos de escrita do Avatar/Guardião.
- Um ticket antes do efeito remoto não substitui uma transação
  distribuída ou reconciliação global.

A prontidão permanece `productionIntegrated=false` e
`safeToExecuteDeletion=false`. A issue **#72** segue aberta.
A `main`, backups protegidos, assinatura permanente, OTA, AAB/APK
e todos os serviços de produção não foram modificados.
