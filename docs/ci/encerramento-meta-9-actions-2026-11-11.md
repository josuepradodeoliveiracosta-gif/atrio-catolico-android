# Encerramento da otimização do GitHub Actions — meta técnica 9,0/10

**Data:** 11/11/2026. **Decisão do mantenedor:** interromper a busca de novas otimizações quando a avaliação de maturidade técnica atingir **9,0/10**, mantendo correções futuras de segurança e falhas reais como manutenção ordinária.

## Escopo e natureza da nota

A nota **9,0/10 é uma avaliação técnica qualitativa** da segurança, cobertura, manutenibilidade, compatibilidade e operação dos workflows **observados**; **não** é certificação externa, índice de velocidade nem garantia de que todos os jobs ficaram mais rápidos. A nota anterior aproximada de 8,5/10 não foi produzida por uma fórmula calibrada. Não comparar pontos decimais como medição objetiva de latência.

A fase é considerada aceita quando os três compromissos combinados forem demonstrados sem regressões relevantes: auditoria quantitativa, modernização segura do CodeQL e verificação integral de checks e `main`.

## Critérios de aceite e evidências

| Compromisso | Evidência | Resultado |
| --- | --- | --- |
| 1. Medir tempo real, filas e metadados | [PR #251](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/251), [comparativo 16+16](comparativo-pre-pos-actions-2026-11-11.md) | Aprovada e incorporada, seis workflows verdes |
| 2. Modernizar o CodeQL sem retirar cobertura | [PR #252](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/252) | Aprovada e incorporada, Java/Kotlin, JS/TS, Python, Actions e contrato verdes |
| 3. Validar estabilidade após incorporação | `main` commit `8c43fe91a79729989c359c00c1878ea16092473d` | Checks de segurança e versão, quatro linguagens CodeQL e build APK debug aprovados |

### Verificação independente após o merge na main

- [CodeQL main, run 43072916396](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916396): **quatro jobs de linguagem e contrato aprovados**; log Kotlin confirma `checkout@v7`, `setup-java@v6`, `setup-gradle` no SHA imutável `0723195856401067f7a2779048b490ace7a47d7c`, Java 17 e Gradle 8.13 mantidos, **acertos do cache Gradle** e **nenhum aviso** de Node 20 nem da depreciação anterior do setup-java.
- [APK debug main, run 43072916394](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916394): build de testes aprovado e artefato `atrio-catolico-firebase-apk` gerado com **28.630.495 bytes**. Etapas de montagem e envio de **APK release assinado foram puladas**, conforme as condições de `workflow_dispatch`; não houve publicação.
- [Segurança main, run 43072916390](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916390) e [conferência da versão, run 43072916523](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916523): sucesso.
- PR #252: todos os seis workflows aprovados, incluindo regras Firestore no emulador, compilação Android, revisão de dependências, CodeQL e contrato. Nenhuma alteração nas regras de produção, assinatura, autorização, Cloudflare, Firebase real, backups ou conteúdo do aplicativo.
- A PR #253, que propunha alterações tecnicamente duplicadas, foi **fechada sem merge** para evitar conflito e trabalho redundante.

### Velocidade — interpretação responsável

| Comparação pontual de runs `main` | Antes | Depois |
| --- | ---: | ---: |
| Job CodeQL Kotlin, [43071949265](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43071949265) vs [43072916396](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916396) | 288 s | 170 s |
| Job de build APK, [43071949166](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43071949166) vs [43072916394](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916394) | 125 s | 114 s |

Comparações **não controladas** de dois commits/execuções, sem evidência de ganho causal ou sustentado. No [relatório pré/pós das 32 execuções](comparativo-pre-pos-actions-2026-11-11.md), diferenças de mediana e P90 não provaram aceleração geral. A nota 9,0/10 refere-se a maturidade e ausência de regressões funcionais na verificação final; **não** a um ganho percentual de desempenho.

## Decisão e limites após atingir a meta

**Encerrar otimização proativa de GitHub Actions nesta fase:** não abrir novas PRs apenas para elevar a nota, reduzir alguns segundos, migrar runners, substituir o provedor Gradle de cache, reconfigurar workflows em massa ou atualizar publicações automaticamente.

**Continuar manutenção necessária**, exclusivamente quando houver evidência concreta: vulnerabilidade, depreciação que bloqueie CI, testes quebrados, falha de builds/assinatura, incompatibilidade efetiva, requisito de segurança ou demanda explicitamente autorizada. Cada correção deve preservar checks, ser isolada, revisada, passar pela PR e possuir rollback.

**Não confundir com homologação do app:** CI verde não comprova implantação em produção, notificações reais, aprovação Play Store, APK assinado oficialmente ou OTA ponta a ponta. Essas demandas permanecem tarefas próprias e não são cobertas pela nota do GitHub Actions.

## Fontes principais

- [Auditoria de latência e metodologia](auditoria-latencia-2026-11-11.md)
- [Política de minutos do repositório público](politica-minutos-actions-repositorio-publico.md)
- [Diagnóstico Kotlin e metadados](diagnostico-gargalos-kotlin-2026-11-11.md)
- [Modernização CodeQL e critérios de aceite](codeql-node24-seguro-meta-9-2026-11-11.md)
