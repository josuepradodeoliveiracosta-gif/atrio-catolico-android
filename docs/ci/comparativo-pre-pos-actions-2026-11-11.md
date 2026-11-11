# Comparação de latência no GitHub Actions após modernização — 11/11/2026

**Escopo:** análise de execuções já concluídas da `main`, sem alterar workflows, configuração, runners, builds, cache, faturamento, secrets, Firebase/Cloudflare, distribuição de APK ou backups. Esta medição **não** valida a meta qualitativa **9,5/10** nem demonstra ganho causal de velocidade.

## Método auditável

- **Origem:** API REST somente leitura do GitHub Actions, `GET /repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs?event=push&branch=main&per_page=100`, complementada com `GET /actions/runs/{run_id}/jobs?per_page=100`; todos os jobs e as etapas foram consultados pelos timestamps oficiais.
- **Amostras:** **16 CodeQL `main`** bem-sucedidos disponíveis no conjunto consultado e **16 APK debug `main`** bem-sucedidos mais recentes dentre 26 disponíveis. Os workflows Android+Firestore de PRs têm composições de código e carga distintas; não são tratados como pares controlados de `main`.
- **Corte temporal fixo:** **11/11/2026 17:04:45 UTC**, início da fase pós-modernização do job obrigatório Firestore, com merge da [PR #245](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/245). A atualização é no job obrigatório de PR, não nos jobs de CodeQL ou APK `main`; o corte permite observar a tendência do CI no período, **não atribuir o efeito de uma mudança nesses outros workflows**.
- **Antes:** 12 execuções por grupo. **Depois:** 4 execuções por grupo. A amostra posterior é pequena e o P90 nearest-rank com `n=4` equivale ao **maior valor**; não serve como comprovação estatística de melhoria.
- **Tempo até fim dos jobs:** `max(jobs[].completed_at) - run_started_at`. **Tempo de job:** `completed_at - started_at`. **Espera até job:** `started_at - run_started_at` (inclui dependências e fila, não apenas indisponibilidade de runners). **Metadados:** `updated_at - max(jobs[].completed_at)`, que não deve ser interpretado como CPU/runner. P90 é `ceil(n*0,9)` na amostra ordenada.
- Foram **excluídas execuções canceladas e falhas** desses cálculos de duração. Há viés de seleção, portanto confiabilidade deve ser avaliada separadamente. Diferenças de cache, mudanças de código e carga simultânea dos runners não foram controladas.

## Medidas de `main`: antes × depois

Valores em **segundos**. Mediana convencional; P90 nearest-rank.

| Grupo / medida | Antes (n=12) mediana | Depois (n=4) mediana | Antes P90 | Depois P90 |
| --- | ---: | ---: | ---: | ---: |
| CodeQL: até terminar todos os jobs | **247,5** | **252** | 279 | 417 |
| CodeQL: duração do job Kotlin | 222 | 245 | 246 | 259 |
| CodeQL: espera até Kotlin iniciar | 6 | 3 | 20 | 167 |
| CodeQL Kotlin: compilação Android instrumentalizada | 104 | 119,5 | 125 | 128 |
| CodeQL Kotlin: análise/publicação Code Scanning | 56 | 66 | 68 | 66 |
| APK debug: até terminar o job | **124,5** | **129,5** | 152 | 147 |
| APK debug: duração do job Android | 120,5 | 116,5 | 132 | 145 |
| APK debug: espera até começar o job | 2,5 | 3 | 30 | 28 |

**Interpretação:** não foi observada uma diminuição consistente de mediana do tempo de conclusão de CodeQL nem de APK `main`. As melhorias de compatibilidade e segurança são comprovadas pelos checks, mas **não se deve anunciar melhoria percentual de velocidade**. No CodeQL, Kotlin continua dominando o caminho crítico; vale preservar todas as quatro linguagens.

### Anomalias importantes

1. [Run CodeQL 43051431150](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43051431150): 288 s até iniciar Kotlin, 497 s até o último job e **781 s até `updated_at`** — **284 s pós-jobs** são diferença de metadados, não tempo em runner. Não otimizar o build por causa dessa cauda administrativa.
2. [Run CodeQL 43065644811](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43065644811): 167 s antes do início do job Kotlin, porém duração do job 250 s. É o principal outlier na pequena amostra posterior; os timestamps, isoladamente, não revelam se a causa é agendamento, concorrência ou outro atraso.
3. [Run APK 43068713485](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43068713485) após PR #250: job Android 145 s, com apenas 2 s de espera. A variabilidade de compilação não desapareceu.
4. O cache Gradle apresentou acertos nos logs dos [pilotos de modernização](piloto-gradle-v5-sha-cache-github-2026-11-11.md). Alterá-lo sem comparação controlada pode piorar a duração ou introduzir riscos.

### Rastreabilidade das execuções amostradas

**CodeQL `main` — antes (12):**
`42899492904`, `42949024556`, `43037350618`, `43049961382`, `43050700764`, `43051431150`, `43052454139`, `43055968928`, `43057772198`, `43059732328`, `43061142272`, `43063267625`.

**CodeQL `main` — depois (4):**
`43064596309`, `43065644811`, `43067399758`, `43068713087`.

**APK debug `main` — antes (12):**
`42899493369`, `42949024618`, `43037350557`, `43049961321`, `43050700739`, `43051431089`, `43052454123`, `43055968876`, `43057771981`, `43059732827`, `43061142257`, `43063267652`.

**APK debug `main` — depois (4):**
`43064596371`, `43065644858`, `43067399738`, `43068713485`.

Cada ID pode ser inspecionado em `https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/<ID>`. Esta tabela é uma fotografia da janela de 11/11/2026 e não equivale a monitoramento contínuo.

## Verificação de segurança: atualizações globais não devem ser incorporadas sem revisão

A [PR Dependabot #29](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/29), que propõe Gradle Actions v6 em vários workflows, apresentou **falha** em [Selos, run 43069072160](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43069072160): o job Android passou, mas o contrato obrigatório `Regras de seguranca Firestore` falhou em `test_existing_safe_caches_kept`, porque `build-apk.yml` deixou de usar `gradle/actions/setup-gradle@v4`. Trata-se de incompatibilidade com o **contrato de CI existente**, não de evidência de que o APK tenha falhado. Não contornar nem relaxar esse contrato e não aprovar a atualização global com base apenas no sucesso do build.

A `main` após a [PR #250](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/250) preserva o **SHA imutável** do Gradle v5 no job obrigatório e mantém inalterados os workflows de release, APK `main`, CodeQL e OTA. Gradle v6 muda o modelo de cache e requer avaliação específica de custo/licenciamento e regressões antes de eventual migração.

## Decisão e critérios para concluir a meta

- **Manter o CI atual:** CodeQL completo, testes Android/Firestore, Gradle v5 fixado por SHA no job obrigatório, caches com acertos e política seletiva de cancelamento de PRs obsoletas. Não introduzir runner maior, novo provedor comercial, deploy ou remoção de checks para perseguir uma nota.
- **Aumentar a amostra pós-modernização** até ao menos 15 runs bem-sucedidos *comparáveis* por grupo, inspecionando também falhas e cancelamentos; verificar mediana, P90, duração de job e espera, sem confundir `updated_at` com tempo em runner.
- **Se o Kotlin persistir como gargalo**, fazer experimentos isolados em PR, com compilação instrumentalizada, cache e diagnósticos completos; manter as quatro linguagens e rollback caso a cobertura ou latência piorem.
- **Não declarar meta 9,5/10 atingida:** falta comprovação de melhoria sustentada da latência, estabilidade e critérios quantitativos previamente aceitos. A implementação avançou; o resultado de desempenho global permanece **inconclusivo**.

Instrumento de auditoria que já existe e **não é modificado por esta PR**: [`scripts/ci_latency_audit.py`](../../scripts/ci_latency_audit.py) e [workflow manual somente leitura](../../.github/workflows/ci-latency-audit.yml). Para a linha de base histórica de PRs, consulte [auditoria anterior](auditoria-latencia-2026-11-11.md).
