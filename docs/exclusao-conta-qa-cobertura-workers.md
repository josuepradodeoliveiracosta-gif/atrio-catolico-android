# Átrio Católico — contrato de cobertura de gravações privilegiadas (QA)

**31/10/2026. Etapa de revisão, sem deploy, sem credenciais reais e sem exclusão de contas.**

Esta etapa foi criada sobre a PR #87 (funções reais dos Workers testadas sob wrapper de QA), que depende de #85 → #84 → #83 → #82 → #81 → #80 → #79 → #78 → #77 → #74 → #73. A issue de privacidade #72 permanece aberta.

## Problema identificado

A PR #87 comprovou que a barreira de QA bloqueia a operação **somente quando o código chama o wrapper**. As funções existentes do Avatar, Átrio Guardião e Push ainda podem executar comandos privilegiados diretamente, contornando a barreira. Não há justificativa para anunciar proteção da produção enquanto esses caminhos não estiverem todos cobertos, inclusive rotas, agendamentos, filas, retries, limpeza de dados e workers antigos.

## Implementação nesta etapa

1. `src/qa-worker-coverage-contract.js` registra as rotas e operações privilegiadas conhecidas (Avatar, Guardião e Push), separando rotas somente-leitura de operações potencialmente mutantes. Seu relatório de prontidão diz explicitamente `productionIntegrated:false`, `safeToExecuteDeletion:false` e `frozenAccountsProtectedInProduction:false`.
2. O catálogo fixa o *Git blob SHA-1* dos quatro arquivos relevantes: os três Worker entrypoints e o adaptador Firestore do Guardião. `qa-worker-coverage-contract.test.js` compara cada byte com o snapshot revisado. Uma edição em qualquer Worker interrompe esse teste até que haja **revisão humana do diff, de todas as rotas e da lista de operações** e atualização deliberada da referência. A fixação **não protege runtime**, mas impede regressões silenciosas em CI.
3. `qa-guardian-review-boundary.integration.test.js` importa e exercita as funções reais `reviewCase` e `resolveReviewCase` do Guardião com Firestore falso e barreira SQL SQLite. Inclui revisão permitida antes do freeze, bloqueio após congelar o dono ou revisor e falha de commit que mantém o ticket aberto. O teste negativo evidencia a ausência de barreira nas funções originais.
4. Mantém os testes anteriores das funções reais de Avatar, Push e Guardião com HTTP simulado. Nenhuma rota de Worker recebe uma nova dependência operacional ou configuração.
5. A lista de lacunas é **explícita** e não pode ser interpretada como cobertura total. Inclui fan-out de muitos destinatários, notificações por tópico, cron/queue, escritas internas em D1, moderação, limpadores de tokens, tentativas repetidas, IAM e revisões antigas implantadas.

## Plano de cobertura antes de produção

| Serviço | Caminhos prioritários para integração futura | Risco |
|---|---|---|
| Avatar | Upload, status que promove imagem, revisão/remover foto, rollbacks, quota/mutex | Qualquer gravação Cloudinary/D1/Firestore durante freeze |
| Guardião | Scanner agendado, processamento de post/denúncia, revisão, restauração e resolução | Conteúdo ou caso novo aparece durante exclusão |
| Push | Eventos de tópico, notificações individuais, FCM, moderação, D1, fila de bots e retries | Notificação ou dado novo de uma conta já congelada |

É obrigatório adicionar a mesma regra a todas as entradas e efeitos, sem confiar somente nos wrappers de teste. O protocolo de produção precisará distinguir o proprietário dos dados, o ator administrativo, múltiplos destinatários e ações de limpeza autorizadas após a retirada da conta. Uma operação de segurança legítima não deverá ser confundida com autorização geral de escrita.

**Sem implantação em produção:** o contrato é um *inventário técnico e detector de alterações*, e não uma implementação real de controle de acesso. A exclusão efetiva continua indisponível até prova de quiescência, inventário completo, processamento seguro entre Firestore/D1/Cloudinary/FCM/Auth, decisão de retenção, portal HTTPS e homologação.

## Execução

O workflow de privacidade já executa os arquivos `cloudflare/account-deletion-audit/src/*.test.js` com Node 22 e SQLite experimental. Os testes são locais e não usam Cloudflare real, Firebase real, tokens nem usuários reais.

`node --experimental-sqlite --test cloudflare/account-deletion-audit/src/*.test.js`

A OTA, os backups, o certificado de assinatura, a Play Store e a branch `main` permanecem inalterados.
