# GitHub Actions — auditoria e plano de custo-benefício (04/11/2026)

> **Estado:** diagnóstico realizado; otimização dos gatilhos **não implementada**. Nenhum workflow, segredo, permissão, cron, Worker, Firebase real, assinatura, backup ou Play Store foi modificado para produzir este relatório. Consulte a [Issue #103](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/103).

## 1. Método e limites da medição

- Fonte: listagem da API GitHub Actions das **300 execuções mais recentes** retornadas, três páginas de 100 registros cada, consultadas em 04/11/2026. O servidor informou **10.304 registros totais**, mas somente 300 foram analisados; não extrapolar.
- Janela dos registros: de **2026-11-04 01:03:59 UTC** até **2026-11-04 15:14:00 UTC** (amostra concentrada no mesmo dia e em alterações frequentes de PRs).
- Base do código para configuração dos 21 workflows: `main` no SHA `deb57ce900b15cf17d95ce3db010b17deb8bb2b3`, após integração documental da PR #100.
- Métrica de duração: diferença aproximada entre `run_started_at` e `updated_at` para execuções `completed` com `conclusion=success`. Os totais abaixo são **arredondados por workflow**. A métrica não mede diretamente minutos faturados, consumo agregado de runners por job ou custo financeiro.
- Ausência de jobs em um recorte pequeno **não comprova** que um workflow é inútil. Para custo monetário, exigir informação de cobrança/uso da conta e política de runners do período, não inventar preço.

| Workflow (nome exibido) | Execuções na amostra | Aprovadas | Outros resultados | Duração total aproximada **das aprovadas** |
| --- | ---: | ---: | --- | ---: |
| Guardião V2 — telas Android no emulador | 19 | 19 | 0 | **140 min** |
| Validar selos (Android e Firestore) | 20 | 16 | 2 falhas, 2 canceladas | **35 min** |
| QA Android dos três bots | 20 | 20 | 0 | **17 min** |
| Guardião V2 — fluxo integrado no Firebase Emulator | 19 | 19 | 0 | **16 min** |
| QA privado Cloud Run, sem deploy | 19 | 19 | 0 | **10 min** |
| Gerar APK do Átrio | 21 | 21 | 0 | **9 min** |
| Google Play — AAB de testes sem assinatura (PR #71) | 20 | 18 | 2 falhas | **9 min** |
| QA Cloudinary sem deploy | 20 | 20 | 0 | 5 min |
| Segurança do repositório público | 21 | 21 | 0 | 4 min |
| Conferir versão oficial | 21 | 21 | 0 | 4 min |
| Testar relay Push | 19 | 19 | 0 | 4 min |
| Guardião V2 — motor offline | 19 | 19 | 0 | 4 min |
| Guardião V2 — triagem autônoma agendada | 11 | 11 | 0 | 3 min |
| Guardião V2 — identidade/observação limitada | 32 | 9 | 20 dispensadas, 3 falhas | 2 min |
| Debug Cloudinary (restrito a branch legada) | 19 | 0 | 19 dispensadas | 0 min |

A soma dos **totais por linha arredondados** é aproximadamente **262 minutos de duração observada** de execuções aprovadas. Não apresentar isso como tempo faturado. Entre esses grupos, a UI Android do Guardião acumula 140 minutos (cerca de 53% da soma arredondada), mas seus filtros de caminhos já restringem o disparo a arquivos relevantes: reduzir indiscriminadamente esses testes seria arriscado.

## 2. Inventário dos 21 workflows na `main`

| Modo e risco | Workflows concretos | Observações |
| --- | --- | --- |
| PR geral, sem filtro por arquivo | `build-apk.yml`, `selos-ci.yml`, `conferir-versao.yml`, `security-audit.yml` | `build-apk` e `selos-ci` são candidatos a **estudo** de seleção de jobs caros em mudanças só de documentação; auditoria de segredos e versão deve continuar |
| PR com filtros de caminhos | `android-bots-ui.yml`, `avatar-cloudinary-ci.yml`, `avatar-live-debug-ci.yml`, `cloudflare-push-ci.yml`, `guardiao-v2-android-ui-ci.yml`, `guardiao-v2-executor-preflight.yml`, `guardiao-v2-fluxo-emulador-ci.yml`, `guardiao-v2-motor-ci.yml`, `guardiao-v2-shadow-ci.yml`, `ota-upgrade-qa.yml`, `qa-official-checks.yml` | Preservar cobertura de código compartilhado, regras Firebase, mudanças de workflow e testes relevantes |
| Cron de execução controlada | `guardiao-v2-moderator-runner.yml`, `guardiao-v2-prod-runner.yml` | **Não** mudar schedule, OIDC, IAM, confirmações, emergência, gates ou produção em busca de economia |
| Somente acionamento manual | `guardiao-v2-qa-wif-manual.yml`, `ota-apk-preflight.yml`, `ota-publish-release.yml`, `qa-official-apk.yml` | Preservar gates, limites de produção, assinatura, revisão e bloqueios |

Condições especiais: `android-bots-ui.yml` e `selos-ci.yml` também possuem disparo `push` restrito a uma branch QA histórica; `build-apk.yml`, `security-audit.yml` e `conferir-versao.yml` usam `push` na `main`; vários workflows dispõem de `workflow_dispatch`. Uma classificação resumida **não substitui a leitura do YAML exato**.

## 3. Oportunidade prioritária: PR exclusivamente documental

A [PR #100](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/100), que modificou apenas Markdown, README e templates de Issue, acionou cinco workflows; entre eles o build Android `build-apk.yml` e os jobs Android/Firestore de `selos-ci.yml`. A revisão de segredos e a conferência de versão continuaram necessárias.

**Proposta ainda não aplicada:** em PRs com **todos** os caminhos numa lista estritamente documental — Markdown sob `docs/` ou `design/`, templates Markdown de Issues e README — manter jobs rápidos e estados de checks, mas avaliar ignorar compilação e emuladores caros. A seleção deve ser implementada preferencialmente como **job de classificação seguido de jobs condicionais**, apenas após auditar checks obrigatórios de proteção de branch: filtros de workflow podem deixar verificações exigidas como pendentes.

Se a lista de arquivos for desconhecida, estiver incompleta, contiver qualquer arquivo técnico, YAML de workflow, arquivo compartilhado ou mudança mista, **não dispensar** testes críticos. Evitar `paths-ignore` amplo e cancelamento de trabalho que esteja produzindo prova obrigatória de segurança.

## 4. Matriz de regressão obrigatória antes de mexer na CI

| Alteração simulada | Regra segura mínima |
| --- | --- |
| Somente `docs/*.md` ou `design/*.md` | Permitir avaliação de dispensa de jobs pesados; segurança e versão permanecem |
| Somente `README.md` ou template `.github/ISSUE_TEMPLATE/*.md` | Tratar como documentação, preservando checks exigidos |
| `app/src/main/**` | Compilar/testar Android e módulos relacionados |
| `app/src/androidTest/**`, `app/build.gradle.kts` ou `settings.gradle.kts` | Reexecutar testes adequados de Android/build |
| `firestore.rules`, `firestore.indexes.json` ou `firebase.json` | Manter testes de regras/integração e validações de segurança |
| `cloudflare/avatar-worker/**`, `cloudflare/push-worker/**` | Testes do Worker correspondente e verificações compartilhadas |
| `cloudflare/guardian-worker/**` | Testes Guardião/integração relevantes, inclusive efeitos sobre regras |
| `tests/security/**` ou `scripts/validar_firebase.py` | Executar testes adequados e não dispensar segurança |
| `.github/workflows/**`, `scripts/ota_release.py` ou scripts de publicação | Auditar permissões, operação, assinatura e testes pertinentes |
| `docs/README.md` **mais** qualquer arquivo executável | Não classificar como documentação pura |
| Arquivo desconhecido, ausência de diff, renomeação não resolvida | **Falhar fechado:** manter verificações relevantes |
| Mudança em proteção de branch ou em checks exigidos | Não promover sem análise de status bloqueante, evidência e reversão |

**Critério de sucesso futuro:** reduzir custo/tempo de PRs exclusivamente documentais **sem aumentar falsos negativos de CI**, sem remover um check obrigatório e com comparação objetiva antes/depois. Exigir testes automatizados dessa matriz e validação com uma PR de ensaio antes de adotar um gate.

## 5. Três falhas do cron de observação — incidente separado

O workflow `guardiao-v2-prod-runner.yml`, que possui cron de observação somente leitura, teve **12 eventos agendados na amostra, 9 aprovados e 3 reprovados**. As execuções [41820308086](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41820308086), [41836033630](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41836033630) e [41847470456](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41847470456) falharam no passo de observar até quatro documentos. O log exibe `GUARDIAN_V2_SHADOW_DENIED` e código de saída 1.

Essa é uma **recusa de gate observada**, não um diagnóstico da causa raiz. **Não desativar a recusa** nem alterar cron/credenciais com a justificativa de reduzir falhas. A investigação está rastreada na [Issue #106](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/106), sem acionamentos de produção.

## 6. Sequência de implementação segura

1. **Concluído:** inventário de 21 arquivos YAML e fotografia de 300 execuções, com duração aproximada e resultados.
2. **Próximo:** levantar regras de branch protection/status checks exigidos e obter dados de minutos faturáveis do proprietário, quando disponíveis.
3. Desenvolver **classificador fail-closed com testes offline** usando a matriz acima; nenhuma alteração de gatilho antes dos testes.
4. Aplicar uma mudança mínima em **PR técnica separada**, preservando `security-audit.yml`, `conferir-versao.yml`, gates de publicação e scripts de produção.
5. Comparar execuções e cobertura antes/depois. Reverter caso qualquer teste crítico deixe de ser executado.
6. Considerar melhorias em cache ou reutilização de dependências somente onde medições e testes provarem ganho.

**Não confundir esta etapa com** [PR #71 de exclusão de contas](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71), que continua em QA sem autorização para efeitos reais. O backup protegido, Workers oficiais, Firebase real, assinaturas e Play Console permanecem fora do escopo.

[Automações](AUTOMACOES.md) · [Índice do projeto](../INDEX.md).
