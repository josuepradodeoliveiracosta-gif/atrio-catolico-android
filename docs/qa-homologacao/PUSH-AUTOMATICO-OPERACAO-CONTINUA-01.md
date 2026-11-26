# Push Automático — operação contínua QA (etapa 1)

Base integrada: PR #466, commit 162f77126dea5994d9ca3f70c1d427d4f0f73a57. O ensaio físico foi aprovado pelo titular e não será repetido por esta etapa. O relatório anterior permanece íntegro; não atribuir tecnicamente os recebimentos ao novo Cron sem evidência. O Worker manual v8 está restaurado, sem Cron. O ensaio v11 é finito e não pode ser reaproveitado: até 60 minutos, 60 ticks e 200 notices, época única.

## Implementação desta PR

Contrato offline de operação contínua separado da época do ensaio. Schema aditivo para época própria, uma ativa por vez, desarmada por padrão, rejeição de identidade D1 divergente, ensaio ainda ativo, reutilização da época anterior e evidência de cota ausente/expirada. Prazo de verificação de cota de até 24h é uma escolha conservadora de projeto, não aprovação de renovação automática. Quatro testes SQLite locais, sem Firebase, FCM, segredos ou Cloudflare remoto. A função somente lê o estado; não arma, não renova, não faz deploy, não é chamada pelo Worker existente.

## Restante necessário para operação contínua

1. Integrar o contrato ao relay, outbox, reserva de Cron, verificação final e modo manual; preservar marcadores de entrega e registros anteriores, nunca reciclar época. Bloquear coexistência de ensaio/manual/contínuo e replays de minuto.
2. Garantir cotas diárias e por invocação, limite de custo zero, margem do consumo compartilhado e alinhamento à janela Pacific do Firestore; não inferir saldo nem renovar evidência de cota sem fonte confiável. Revisar consumo de D1/Workers e expiração de slots. A autorização permanente não significa execução ilimitada.
3. Testes de integração de corrida, desarme, expiração, duplicação, quota, rollback, autenticação e isolamento QA. Validar CI e preparar pacote desarmado. Sem novo teste físico obrigatório nesta etapa.
4. Migrar aditivamente apenas D1 QA dedicado, armar uma nova época com evidências atuais e aplicar somente no Worker QA; verificar estado e critérios de parada. Não ampliar IAM, não vincular faturamento, não tocar produção/main, não publicar APK.

A PR não autoriza ativação remota até a implementação e validação completas. A aprovação física anterior não é certificação de CPU hospedada, origem do Cron ou disponibilidade de cotas futuras.

## Etapa 2 — integração do candidato

O modo explícito continuous exige QA_AUTO_CONTINUOUS_ENABLED=true, além dos controles já existentes. O relay, o medidor, as operações atômicas da outbox e a reserva de minuto compartilham o predicado da nova época. O modo experimental conserva sua tabela e limite de vida. O candidato manual bloqueia enquanto houver época contínua habilitada ou slot vivo; para voltar à versão manual histórica, desarmar, retirar Cron e aguardar drenagem. Não há API de ativação ou renovação. O pacote local agendado inclui as tabelas vazias.

Os testes adicionais cobrem concorrência de publicação/claim, desarme e estado terminal unknown, reserva de minuto sem replay, bloqueio de modo manual, expiração da cota, schema sem ativação e ausência de disparo público. A CI deve validar esta revisão antes de qualquer integração.

**Ainda não implantável remotamente:** reavaliar teto diário na janela Pacific do Firestore, orçamento de D1 por linha e invocação, consumo compartilhado, identidade real da base e renovação de evidência de cota; testar a composição contínua de ponta a ponta no runtime local com transporte sintético. A autorização remota não se deduz do sucesso dos testes de contrato.

## Etapa 3 — limites operacionais e validação do fluxo

A CI da etapa 2 (45910797022) terminou com os três jobs aprovados. Nesta revisão, o orçamento contínuo compartilha os registros UTC do ensaio, mas limita o dia a 1.440 descobertas, 20 trabalhos de entrega e 75 consultas de aviso. A reserva atômica agrega também a data UTC anterior e nega novos gastos quando a soma ponderada ultrapassaria 12.840 leituras estimadas. Um dia civil do Pacífico está contido em duas datas UTC, inclusive nas transições sazonais. O orçamento conservador de dois dias exclusivamente contínuos é 12.750 leituras estimadas; a reserva também contabiliza eventual consumo anterior do ensaio. Não representa o consumo total do projeto, saldo real nem garantia de faturamento zero. O limite de escrita Firestore deste fluxo continua zero; as reservas D1 e os limites de transporte por invocação continuam separados. As reservas não têm reembolso.

Foram acrescentados testes de limites concorrentes, consumo anterior, rejeição antes de I/O e fluxo sintético completo do agendamento até a leitura do aviso, incluindo replay e desarme. O teste usa SQLite, chave RSA efêmera e transporte simulado, sem segredos de QA ou serviços externos. A nova revisão precisa passar na CI. O limite de linhas D1 com histórico representativo, os saldos reais compartilhados e a evidência de cota continuam sendo condições de ativação; não se deve criar ou renovar uma autorização de cota a partir de números simulados. Sem alteração remota do Worker, D1 ou Cron nesta etapa.
