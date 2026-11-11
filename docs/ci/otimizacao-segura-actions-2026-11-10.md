# Otimização segura do GitHub Actions — referência e critérios de aceite

Data da avaliação: 2026-11-10 (UTC). Escopo: **somente CI**, sem deploy, publicação, alteração de Firestore/Cloudflare, chaves, regras da `main` ou backups.

## Referência medida antes das mudanças

Amostra real da mesma PR (`feat/github-codeql-review-20261110`) no GitHub Actions, horários UTC. São tempos de execução de cada workflow, **não** tempos a somar (foram disparados em paralelo).

| Workflow | Run | Tempo aproximado |
| --- | --- | ---: |
| Build APK adicional de PR | [42898674664](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42898674664) | 1min54s |
| Selos/Firestore, incluindo o Android obrigatório | [42898674687](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42898674687) | 2min22s |
| CodeQL (quatro linguagens) | [42898674931](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42898674931) | 4min36s |

No CodeQL, o job Java/Kotlin levou ~4min25s, com ~2min20s de compilação e ~1min09s de análise. Esta compilação permanece porque faz parte do modo de análise escolhido. Os tempos podem variar conforme carga dos runners e cache.

## Decisões aplicadas nesta PR

1. **Medição:** baseline com URLs e durações acima. Comparar com PRs semelhantes após eventual merge; sem prometer economia de tempo ainda não medida.
2. **Menos compilação duplicada:** `build-apk.yml` roda somente em `main` ou `workflow_dispatch`. No evento `pull_request`, o check **Compilar Android de testes** de `selos-ci.yml` continua executando testes, `assembleDebug` e `assembleDebugAndroidTest`, fornecendo o APK debug para a PR. O APK da `main` e o release manual permanecem no workflow de build.
3. **Paralelismo com propósito:** preservados os jobs independentes de Firestore/Android e a matriz CodeQL (`max-parallel: 4`). Não forçar 20 jobs ou dividir bundles muito curtos só para ocupar runners: o custo de inicialização pode ultrapassar o ganho.
4. **Execuções obsoletas:** apenas CodeQL e Selos de commits anteriores **da mesma PR** podem ser cancelados, para dar espaço à revisão do commit mais recente. Não cancelar automaticamente push, cron, execução manual, publicação, backup ou operação com escrita.
5. **Cache:** mantido `gradle/actions/setup-gradle` com cache próprio e cache `npm` indexado por `tests/security/package-lock.json`. Não trocar cache confiável por configuração especulativa; segredos e artefatos de assinatura nunca vão ao cache.
6. **Menos ruído e falhas de limite:** o relatório `ci-quality-report.yml` deixa de ser disparado para cada PR e quatro tipos de workflows; passa a disparar após conclusão do CodeQL (além de `workflow_dispatch`), ignorando execução cancelada. O relatório é informativo, **não** um gate final: outros checks podem permanecer pendentes, e o próprio relatório destaca isso. O observador Guardião V2 é agendado a cada duas horas em vez de a cada hora; a PR deixa de disparar seu workflow de produção (antes resultava em job ignorado e contava no orçamento diário). Os controles de identidade, leitura somente, limites diários e aprovação manual permanecem.
7. **Validação:** `scripts/test_ci_optimization_contract.py` executa dentro do check obrigatório `Regras de seguranca Firestore`. O contrato específico do CodeQL e o teste do Guardião foram atualizados. Não fazer merge enquanto houver erro, conflito, check obrigatório ausente ou testes sem evidências.

## Proteções que não podem ser enfraquecidas

A proteção da `main` exige os checks **Detectar segredos em arquivos e histórico Git**, **Evitar regressão de versionCode e versionName**, **Regras de seguranca Firestore**, **Compilar Android de testes** e **Bloquear exclusoes em massa (Atrio)**. Os nomes desses checks são preservados; o ruleset não é alterado.

`build-apk.yml` continua exigindo aprovação e homologação específicas para Release/OTA, e o observador do Guardião continua leitura somente. Não há nenhuma alteração de assinatura, publicação, chaves, IAM, dados ou backup.

## Verificação antes e depois

- Comparar PR com alterações Android semelhantes, medindo *tempo até todos os checks obrigatórios concluídos*, *tempo do CodeQL* e *quantidade de builds Debug no mesmo SHA*.
- Medir *jobs-minutos* e execuções canceladas, distinguindo run cancelado deliberadamente de falha real.
- Verificar que o check obrigatório Android e seus testes nunca foram removidos nem transformados em `skipped`.
- Confirmar que o Guardião passa sem eventos `pull_request` e que a política fail-closed permanece; o agendamento de duas horas não ativa a moderação.
- Se a economia não for observada ou houver regressão, reverter somente as alterações desta PR.

**Não há ganho percentual garantido antes dessa comparação.** Nenhuma mudança desta PR deve ser implantada diretamente em produção sem revisão e checks verdes.
