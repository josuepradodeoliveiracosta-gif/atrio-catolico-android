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
