# Guardião V2 — primeiro estágio recorrente de observação

**O estágio é estritamente de leitura; não constitui moderação automática ativa.**

## Execução e autorização

- GitHub Actions `.github/workflows/guardiao-v2-prod-runner.yml` possui cron `17 * * * *` (UTC), limitado pelas condições do provedor Google WIF a repositório, `main` e workflow exatos.
- Uma execução é **somente sombra/observação**: classifica até **dois posts e duas respostas** da última hora, sem gravar casos, avisos, dados pessoais, decisões ou logs de texto. Também consulta `guardian_config/policy`.
- Usa credencial OAuth de cinco minutos pelo WIF. Não tem chave JSON. Token e dados não aparecem nos logs.
- Limite por execução: **um GET de configuração e, quando habilitado, até dois `runQuery` de leitura com `limit=2` cada**. Firestore usa POST para consultas `runQuery`, não é escrita.
- Limite por dia do workflow: a API GitHub deve confirmar no máximo **24 execuções do mesmo workflow naquele dia**, abrangendo manuais e agendadas, antes da consulta ao Firestore. Sem resposta do GitHub, tentativa repetida, contexto inválido, índice indisponível, documento inesperado ou falha de autenticação: **o processo para fechado**. A concorrência usa uma única fila.
- O limite protege o workflow próprio, **não constitui cota transacional global** do Firebase. Consultas Firestore podem consumir leituras de índices; outros serviços do aplicativo continuam somando consumo. Custos e quota gratuitos não estão garantidos.
- Com a configuração atual `guardian_config/policy` (`enabled=false`, `allowHold=false`, `emergencyStop=true` e `shadowEnabled` ainda ausente), o cron emite **`PAUSED_BY_POLICY`** e não lê publicações. Ainda há custo eventual de execução GitHub e uma consulta de configuração.
- A primeira mudança para modo sombra exige avaliação manual da configuração com **`enabled=false`, `shadowEnabled=true`, `emergencyStop=false`, `allowHold=false`**, sem ativar flags de escrita, Worker Cloudflare ou retenção. O campo `shadowEnabled` ausente é interpretado como `false`; se `enabled=true`, o observador para, mesmo com `shadowEnabled=true`. Não fazer isso antes de observar o primeiro ciclo agendado e revisar IAM/permissão de query.
- O console só registra `documents` e `possibleSignals`, sem nomes, textos, caminhos ou identificadores.
- Não existem tarefas de escrita nem de notificação neste estágio. Um fluxo de moderação com casos e avisos exige implantação separada, autorização de IAM mínima, proteção transacional de orçamento, supervisão humana e rollback.

## Teste manual

No GitHub Actions em `main`, habilitar `confirm_identity_test` e `confirm_shadow_scan`. A `confirm_config_read` não precisa ser marcada para esse teste. A operação falha se não houver confirmação.

O modo inicial responde `GUARDIAN_V2_SHADOW PAUSED_BY_POLICY documents=0 possibleSignals=0` devido à parada emergencial vigente. Não declare a análise ativa enquanto esse resultado persistir. Não executar testes sintéticos invasivos em coleções de usuários.

## Desligamento

Reativar `emergencyStop=true` em `guardian_config/policy` para impedir a varredura; retirar `schedule` do workflow ou desativar o workflow de GitHub para cancelar a recorrência. Nenhuma dessas ações exige conceder `roles/datastore.user`. 
