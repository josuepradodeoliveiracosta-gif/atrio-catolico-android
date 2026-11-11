# Diagnóstico real de gargalos — CodeQL Kotlin e GitHub Actions

**Data:** 11/11/2026 (UTC). **Escopo:** análise de runs reais e aperfeiçoamento do relatório de latência **somente leitura**. Nenhum teste, workflow, cache, Gradle, APK, worker, segredo, ruleset ou backup é alterado por esta etapa.

## O que os logs mostram

| Execução | Espera até Kotlin | Job Kotlin | Compilação Android | Análise CodeQL |
| --- | ---: | ---: | ---: | ---: |
| [PR #241 — run 43057059104](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43057059104) | 3 s | 232 s | 118 s | 62 s |
| [PR #240 — run 43055122580](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43055122580) | 3 s | 268 s | 142 s | 71 s |
| [`main` após #240 — run 43055968928](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43055968928) | 3 s | 183 s | 83 s | 48 s |

Tempos: `run_started_at`, `job.started_at/completed_at` e `steps[].started_at/completed_at` da API do GitHub, arredondados. Os tempos de steps não precisam somar exatamente a duração do job. Amostras de PRs e commits distintos: **não demonstram ganho causal** de otimização.

### Um caso que exigiu correção na interpretação

[CodeQL `main` run 43051431150](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43051431150) registrou:

- `run_started_at`: 15:44:54 UTC.
- Início do Kotlin: 15:49:42 UTC (**288 s** após início do workflow).
- Fim do último job Kotlin: 15:53:11 UTC (**497 s** após início do workflow).
- `updated_at` do workflow: 15:57:55 UTC (**781 s** após o início; **284 s** após o fim dos jobs).

O atraso antes de iniciar o job pode incluir disponibilidade de runners, dependências e agendamento; **não se pode afirmar a causa apenas pelos horários**. O intervalo depois do último job não deve ser atribuído a CPU, trabalho de compilação ou fila: é a diferença observada entre conclusão dos jobs e atualização do metadado do workflow.

## Mudança técnica nesta PR

O script existente `scripts/ci_latency_audit.py` passa a registrar, além do que já media:

1. `to_last_job_sec`: até o término do último job bem-sucedido da execução.
2. `post_jobs_metadata_sec`: intervalo positivo observado entre o fim do último job e `updated_at`; caso os horários sejam incoerentes, usa `null`, sem inventar duração.
3. `critical_steps`: até três etapas mais demoradas do **último job**, utilizando `steps` já incluídos no mesmo endpoint GET de jobs.
4. Mediana e P90 de `to_last_job_sec` por grupo, além da mediana do intervalo de atualização de metadados.

O Markdown e JSON do workflow **manual** de auditoria passam a exibir essa decomposição. Os testes offline cobrem timestamps anômalos, etapas puladas, entrada malformada, relatório e escaping Markdown. **Não adicionamos chamadas de API, jobs por PR, permissões ou secrets.**

## Decisão de otimização

A maior parcela de trabalho das execuções recentes do CodeQL Kotlin é a **compilação debug instrumentalizada** e a **análise de segurança**. Não remover a compilação Kotlin manual nem qualquer uma das quatro linguagens CodeQL. A compilação de validação Android também continua obrigatória. Elas têm responsabilidades diferentes e executam isoladas em runners separados.

Há indícios de cache Gradle funcionando na auditoria inicial; alterar caches, parâmetros de compilação ou runner sem um experimento comparável pode criar regressão ou reduzir a cobertura. Neste momento, **não foi demonstrada uma mudança de build com benefício líquido seguro**. A melhoria desta PR é tornar a medição fiel e reproduzível, para selecionar a próxima intervenção fundamentada em dados.

## Aceite

- Todos os checks obrigatórios na PR e as quatro linguagens CodeQL aprovados.
- Testes do relatório no check obrigatório Firestore.
- Sem alteração de timeouts, gatilhos, segurança, custo, deploy ou distribuição.
- Medir mais execuções com carga similar; separar fila, execução e atraso de metadados antes de propor mudanças no build.
- Meta de desempenho **9,5/10 ainda não comprovada**; não somar jobs paralelos para estimar duração de calendário.
