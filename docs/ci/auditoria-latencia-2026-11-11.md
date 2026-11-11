# Auditoria da latência do GitHub Actions — etapa 1/5

Data: 2026-11-11 (UTC). Meta futura: 9,5/10, **não concedida antecipadamente**. Escopo: análise e instrumento de medição, sem deploy, alterações de produção, release, backups ou flexibilização do ruleset.

## Método

Foram examinados **39 workflow runs concluídos com sucesso** a partir dos 100 eventos recentes `pull_request` e dos 100 eventos `push` na `main` (API GitHub Actions). Grupos: 11 CodeQL PR, 10 Selos PR, 15 builds debug `main`, 3 CodeQL `main`. São execuções de **commits, branches e cargas de runners diferentes**; não configuram benchmark controlado.

- Tempo total observado = `updated_at - run_started_at`, arredondado a segundos. Pode incluir tempo de fila e atualização de estado; não é exatamente CPU ou cobrança.
- Espera até começar um job = `job.started_at - run.run_started_at`. **Inclui dependências `needs`, espera de alocação de runner e outras causas**; não identifica exclusivamente falta de capacidade.
- Tempo efetivo de job = `job.completed_at - job.started_at`. Somar durações de jobs paralelos não fornece tempo de calendário.
- Mediana convencional (para amostras pares, média dos dois valores centrais); P90 do posto mais próximo (nearest-rank). Amostras abaixo de 10 precisam de forte ressalva.
- Filtrados runs cancelados ou com falhas. Isso pode produzir **viés de seleção**: para estimar confiabilidade e custo, analisá-los separadamente.

## Linha de base observada

| Workflow | N | Mediana total | P90 total | Menor–maior |
| --- | ---: | ---: | ---: | ---: |
| CodeQL PR | 11 | **284s (4min44s)** | **651s (10min51s)** | 203–688s |
| Selos Android + Firestore PR | 10 | **139s (2min19s)** | **477s (7min57s)** | 105–544s |
| APK debug push `main` | 15 | **133s (2min13s)** | **159s (2min39s)** | 92–187s |
| CodeQL push `main` | 3 | 250s (4min10s) | 257s | 246–257s |

Essas linhas não devem ser somadas: muitos workflows foram disparados simultaneamente.

### Observações de filas e caminho crítico

1. [CodeQL PR, run 42949257642](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949257642): **688s** até conclusão; job Kotlin começou **482s** após o início do workflow e executou por **206s**. Cerca de 70% do tempo decorrido precedeu o início do job Kotlin. Trata-se de espera até o job, não medida pura de fila.
2. [CodeQL PR, run 42949269170](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949269170): **651s** total; Kotlin começou após **493s** e executou **158s**. Houve várias PRs do Dependabot iniciadas na mesma janela de minutos.
3. [Selos PR, run 42949273974](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949273974): **544s** total; job Android aguardou **427s** até começar e durou **117s**.
4. [CodeQL PR, run 43034658776](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43034658776): **203s** total, Kotlin começou após **10s** e durou **192s**. A diferença para os outliers acima está principalmente na espera pelo job, não necessariamente no código.

**Interpretação:** explosões de jobs simultâneos e alocação de runners merecem prioridade na etapa 2; não podemos prometer que otimizar Gradle por si só eliminará os outliers. Também há variação do build Kotlin.

### Cache e preparação do CodeQL

Nos logs do job Kotlin de [42949257642](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949257642) e [43037350618](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43037350618) foram observados **cache hits** para artefatos Gradle (dependências, transformações, Kotlin DSL e Gradle 8.13). O fluxo ainda baixa ferramentas do Android e do CodeQL conforme necessário. Antes de propor um cache novo, medir custo de obtenção, proteção contra cache poisoning e benefício líquido. Não armazenar credenciais nem material de assinatura.

### Comparação pontual pré/pós PR #235 (não controlada)

| Fluxo | Antes | Depois | Advertência |
| --- | ---: | ---: | --- |
| Selos PR: [42947662023](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42947662023) vs [43036578036](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43036578036) | 146s | 107s | PRs distintas, não atribuir 27% exclusivamente ao CI |
| CodeQL PR: [42947662054](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42947662054) vs [43036577310](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43036577310) | 214s | 252s | Não há ganho comprovado |
| APK `main`: [42949024618](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949024618) vs [43037350557](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43037350557) | 110s | 141s | Variação de carga/cache |
| CodeQL `main`: [42949024556](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949024556) vs [43037350618](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43037350618) | 257s | 250s | Diferença pequena; amostra insuficiente |

## Como repetir a auditoria sem aumentar os jobs das PRs

`scripts/ci_latency_audit.py` consulta **somente endpoints GET** fixos de execuções e jobs do próprio repositório. Captura até 15 runs por grupo e separa tempo total, duração de jobs e espera até início do job crítico. Grava `ci-latency.json` e `ci-latency.md`. A permissão `actions: read` é suficiente. O workflow manual `ci-latency-audit.yml` mantém `contents: read`, usa `workflow_dispatch` e **não cria job em toda PR**. Seus testes unitários são executados no check obrigatório Firestore. O instrumento deve ser validado numa PR antes de incorporado à `main`.

## Próximas decisões (etapas 2–5)

1. **CodeQL e fila:** verificar se picos decorrem principalmente de bursts do Dependabot, `needs` ou capacidade dos runners; evitar duplicação de compilação apenas se cobertura Kotlin ficar idêntica. Nunca cancelar manual, scheduled ou builds oficiais por otimização de PR.
2. **Caches:** comparar acertos e durações em pelo menos dez runs novos; manter cache Gradle/npm já funcional se mudança não demonstrar ganho.
3. **Paralelismo:** validar PRs que alterem só Avatar ou só Push para comprovar seleção do empacotamento, sem disparar jobs artificiais.
4. **Actions:** avaliar atualizações Node 20→24 e Dependabot **em PRs isoladas**, comparando logs e riscos antes de integrá-las.
5. **Aceite 9,5:** reduzir a mediana ou P90 dos fluxos críticos em amostras comparáveis, sem deteriorar o resto; cinco checks obrigatórios, CodeQL completo, zero regressão de release/OTA e review humano. **Nenhum percentual de ganho global comprovado nesta etapa.**

Os snapshots de origem permanecem nos respectivos runs do GitHub. Nenhum segredo ou dado pessoal é necessário para a análise.

## Continuação: decomposição por etapas e metadados

A [análise de gargalos com evidências da PR #241 e da `main`](diagnostico-gargalos-kotlin-2026-11-11.md) acrescenta ao instrumento de auditoria a duração até o último job, o intervalo entre sua conclusão e `updated_at`, e as etapas mais longas do job crítico. O tempo de atualização de metadados **não deve ser contado como fila ou CPU**. A linha de base histórica acima é mantida intacta para comparação.
