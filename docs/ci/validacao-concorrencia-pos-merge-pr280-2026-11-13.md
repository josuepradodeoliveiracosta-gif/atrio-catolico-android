# GitHub Actions — validação de concorrência após merge da PR #280

**Data local:** 13/11/2026 (UTC−03:00). As execuções citadas pelo GitHub aparecem em **14/11/2026 UTC**.  
**Escopo:** auditoria **somente de leitura** no GitHub; sem novo disparo manual de workflows, sem reruns e sem acesso a Firebase/Cloudflare ou produção.  
**Commit anterior:** `42969d1ae5f5f50e43db4471a1265102ab02bded` (após PR #279).  
**Commit posterior:** `798d318c8818f8d7e3421435876bedbd5134d6c5` (merge da [PR #280](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/280)).

## 1. Resultado funcional verificado

Na PR #280, todas as **11 execuções de workflow** foram aprovadas e o commit de origem teve **23/23 checks com conclusão success**, incluindo os cinco obrigatórios (proteção contra exclusões, segredos/histórico Git, versão, Firestore e compilação Android). CodeQL Java/Kotlin, JavaScript/TypeScript, Python e Actions foi aprovado.

No commit de merge da `main`, a API de execuções mostrou as seguintes conclusões:

| Workflow pós-merge | Run | Evento | Resultado | Tempo observado de workflow |
| --- | --- | --- | --- | ---: |
| CodeQL (quatro linguagens) | [43535679782](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43535679782) | push | success | 206 s |
| APK de teste / build main | [43535679739](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43535679739) | push | success | 143 s |
| Verificação de versão | [43535679948](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43535679948) | push | success | 10 s |
| Segurança pública | [43535679815](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43535679815) | push | success | 12 s |
| Relatório de diagnóstico | [43536067463](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43536067463) | workflow_run | success | 13 s |

O CodeQL terminou em **00:43:11Z**, seguido pelo disparo do relatório de diagnóstico em **00:43:13Z**, concluído em **00:43:26Z**. O workflow de autocorreção automática permanece sem o gatilho `workflow_run` por decisão já integrada na PR #279; não houve alteração nele na PR #280.

A inspeção do código na `main` confirmou o padrão de concorrência com isolamento por `run_id` fora das PRs e cancelamento **somente de versões obsoletas da mesma PR** nos cinco workflows opcionais de QA modificados. Os gatilhos, jobs, matriz de três suítes dos bots, quatro linguagens CodeQL e checks obrigatórios foram preservados.

## 2. Evidência concreta de paralelismo

Na PR #280, os três jobs da matriz `QA Android dos três bots` iniciaram **simultaneamente em 00:22:50Z**:

| Job | Início (UTC) | Fim (UTC) | Duração do job |
| --- | --- | --- | ---: |
| `bots` | 00:22:50 | 00:28:44 | 354 s |
| `interaction` | 00:22:50 | 00:29:33 | 403 s |
| `profiles` | 00:22:50 | 00:30:59 | 489 s |

Outros jobs de QA — Guardião UI (339 s), OTA upgrade (239 s) e OTA In-App (463 s) — também começaram nessa janela, com resultado `success`. Isso **demonstra execução simultânea** no ambiente observado; não demonstra **redução causal de latência** da PR #280, porque a matriz de bots já estava paralelizada antes.

A nova regra de `concurrency` tem efeito especialmente quando há **vários commits na mesma PR** ou **execuções manuais na mesma ref**, eventos que não foram produzidos artificialmente nesta validação.

## 3. Comparação histórica, com limitações explícitas

Consulta usada: GitHub REST `GET /repos/<repo>/actions/runs?per_page=60&event=push&branch=main&status=success`, com seleção das **13 execuções concluídas imediatamente anteriores** à PR #280 para cada fluxo e a única posterior disponível.

**Definição:** tempo de workflow = `updated_at - run_started_at`, em segundos, como na auditoria histórica do repositório. Pode incluir atraso de atualização de metadados; **não mede tempo de CPU, custo nem exclusivamente espera na fila**.

| Workflow | Antes: amostra | Antes: mediana | Antes: P90 | Após: amostra | Após: tempo |
| --- | ---: | ---: | ---: | ---: | ---: |
| CodeQL `push main` | 13 | **236 s** | **279 s** | **1** | **206 s** |
| Build APK `push main` | 13 | **134 s** | **140 s** | **1** | **143 s** |

**IDs da amostra antes do merge**, ordem mais recente primeiro:

- CodeQL: `43531247723`, `43495821435`, `43488931036`, `43469694645`, `43466577176`, `43462771173`, `43458814084`, `43454775059`, `43450096463`, `43444206665`, `43439014804`, `43435158709`, `43350189312`.
- APK: `43531247713`, `43495821357`, `43488931060`, `43469694634`, `43466577182`, `43462771249`, `43458814232`, `43454775051`, `43450096494`, `43444206733`, `43439014682`, `43435158672`, `43350189203`.

Nos **jobs individuais** de dois commits consecutivos da `main`, a API de check runs registrou:

| Job | Antes (segundos) | Após (segundos) |
| --- | ---: | ---: |
| CodeQL Java/Kotlin | 207 | 203 |
| CodeQL JavaScript/TypeScript | 59 | 69 |
| CodeQL Python | 67 | 67 |
| CodeQL Actions | 42 | 41 |
| Compilação Android | 122 | 139 |

**Não atribuir causalidade:** a PR #280 modificou só workflows opcionais de QA, sem alterar as etapas de CodeQL ou do APK na `main`; por isso variações de velocidade destes fluxos não são indicador direto do benefício da correção de concorrência. O pós-merge tem **n=1** por fluxo. Cargas, cache, commits e estado do runner não são controlados.

## 4. Critérios de maturidade e trabalho ainda não comprovado

**Comprovado por configuração e execução real:** isolamento por evento/grupo no YAML, cancelamento apenas por PR, suíte/matriz intactas, checks obrigatórios aprovados e execução paralela observada sem falhas.

**Ainda não comprovado empiricamente:**

1. Se dois `workflow_dispatch` do mesmo workflow/ref, criados de forma natural, coexistem sem cancelamento/substituição.
2. Se dois commits sucessivos na mesma PR resultam em cancelamento somente dos checks obsoletos e conclusão integral dos checks do SHA mais novo.
3. Se a mudança reduz tempo de fila, uso total de runner ou P90 em uma amostra comparável de PRs com workflows opcionais; amostras de builds `main` não respondem a essa pergunta.
4. Se alguma variação inesperada ocorre sob concorrência alta ou múltiplas PRs.

**Próxima medição segura:** aproveitar eventos futuros **naturais** de atualização da mesma PR e de dispatch manual previamente autorizado; consultar status, início/fim e `concurrency` de cada run. Não iniciar emuladores ou alterar código apenas para produzir um benchmark. O monitor `ci-latency-audit.yml` permanece disponível, mas sua execução manual não é necessária para este relatório.

**Avaliação:** a correção atende aos problemas específicos identificados e passou integralmente nos testes conhecidos; **a nota de paralelismo e concorrência 10/10 permanece meta, não resultado demonstrado por métricas**. Esta análise não afirma que toda a CI esteja 10/10 nem que os problemas independentes de segurança/Guardião listados em outra auditoria tenham sido corrigidos.

## 5. Governança

Documento preparado em **branch própria**, sem alterações em workflows, aplicativos, permissões, regras de produção, backups, serviços, cron, dados ou `main`. Qualquer merge requer autorização expressa. Reavaliar as métricas com amostra adequada antes de elevar a nota por evidência.
