# Etapa 9 — Homologação histórica concluída e encerrada em QA

Data: 12/11/2026. Evidência preservada para auditoria na PR #259.

## O que foi comprovado

A execução manual [#145](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43276217629), feita a partir do commit QA `c2589cb07ed4f2a3b13ee750864bb24d03137e54`, terminou com sucesso e gerou os cinco arquivos de evidência.

O *replay histórico* usou somente nesta prova o SHA
`e046f3c3609b8fee5e7b0064646ec174ab3ca2d3`, cujo run
`42866978165` tinha o job `130007825671` legitimamente falho.
O verificador confirmou **1/1 identidades** e o analisador classificou **1/1 logs**
em memória com os IDs estáticos `android_adb_offline` e
`android_compose_timeout`. Classificação:
`multiple_signals_review_needed`, **sem afirmar causa raiz**.

O artefato `ci-readonly-43276217629` contém:
`ci-report.json`, `ci-diagnostics.json`, `ci-job-evidence.json`,
`ci-log-signals.json`, `ci-report.md`. Não inclui texto bruto de logs.
Os cinco checks obrigatórios eram `success`; o job falho era opcional.
Nenhum merge, deploy, rerun ou reparo ocorreu.

Como controle, a execução [#144](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43276062160)
usou o HEAD corrente e não gerou sinal de falha: o botão especial não estava
marcado. Essa execução não demonstra classificação positiva.

## Decisão pré-integração da PR #259

Para evitar que o workflow padrão carregue exceções e compromissos com IDs históricos
de teste, o **input temporário `qa_historical_replay` e o SHA fixo foram removidos**
do arquivo `.github/workflows/ci-quality-report.yml` na revisão pré-integração
da mesma PR. A prova operacional acima está registrada e continua consultável,
mas **não existe opção de replay no workflow candidato definitivo**.

O `workflow_dispatch` normal e o evento `workflow_run` foram mantidos,
com os mesmos scripts de leitura/triagem, permissões somente leitura e artefatos.
A classificação positiva já foi exercitada no workflow QA no commit anterior;
a versão candidata sem o botão temporário precisa passar pelos seus próprios
checks no SHA atual antes de ser considerada tecnicamente validada.

O teste de integração **offline** com metadados e log sintéticos permanece
para detectar regressões futuras, sem incorporar o texto dos logs históricos
aos arquivos do repositório. Não há motivo para fabricar erros ou promover o
modo de replay QA à `main`.

## Limites e autorização

- O diagnóstico detecta sinais; não há comprovação de causa raiz.
- Os casos do holdout continuam sem atestação humana; precisão causal de 90%
  não está demonstrada.
- Nenhuma análise desta PR concede autorização de merge ou deploy.
- A `main`, o ambiente de produção e os backups não foram modificados nesta etapa.
- A automação `workflow_run` da nova versão só poderá ser confirmada na branch
  padrão **depois** de uma decisão expressa de integração. A prova QA é distinta
  da prova pós-integração.
