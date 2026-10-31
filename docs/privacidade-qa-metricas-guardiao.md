# Privacidade — resumo automático do Guardião (QA)

Esta etapa na PR #98 adiciona `qa-guardian-runtime-metrics-gate.js`, que permite gravar somente o resumo global `guardian_runtime/last_scan` da varredura automática, preservando as quatro restrições anteriores de checkpoint paginado.

O contrato aceita exclusivamente `scannedAt` e os seis contadores agregados `review`, `warn`, `error`, `changed`, `backlogGroups` e `pausedGroups`. Campos com UID, texto da publicação, IP ou identificador de caso são rejeitados, assim como contadores fora do intervalo, timestamps inválidos, regressão de horário e atualizações com versão obsoleta. O código de QA exerce a função verdadeira `scanPagedCycle` e o Guardião com infraestrutura simulada.

Uma falha causada por conta congelada mantém o cursor de moderação pendente. O resumo global pode registrar erros sem adquirir permissão para gravar conteúdo do usuário. Nenhuma API de exclusão, autenticação real, cron implantado ou credencial de produção foi adicionada.

**Limites:** esse é um adaptador de homologação não importado pelo Worker implantado. Não garante que serviços reais respeitem o congelamento; dependências de IAM, outros Workers e retenção seguem abertas na issue #72. `main`, assinatura Android, OTA, backups e produção permanecem intocados.
