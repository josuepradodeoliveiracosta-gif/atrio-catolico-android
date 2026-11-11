# Meta 9,0/10 — conclusão e regra de parada da otimização do CI

**Data:** 11/11/2026 (UTC). **Referência validada:** `main`, commit `8c43fe91a79729989c359c00c1878ea16092473d`.

## Decisão

**Avaliação técnica do fluxo central de CI: 9,0/10.** Esta é uma **nota qualitativa de maturidade operacional**, não um benchmark oficial do GitHub nem prova de ganho percentual de velocidade. A avaliação segue os **três critérios de encerramento acordados**, sem modificar a escala durante a execução:

| Critério acordado | Evidência observada | Resultado |
| --- | --- | --- |
| 1. Auditoria final com dados reais | [PR #251](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/251) integrada; [comparativo 12+4 execuções por grupo](comparativo-pre-pos-actions-2026-11-11.md) publicado, sem alegação de ganho causal | **Concluído** |
| 2. Modernizar CodeQL preservando segurança | [PR #252](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/252) integrada; `checkout@v7`, `setup-java@v6`, Gradle v5.0.2 **por SHA imutável**, quatro linguagens e contratos preservados | **Concluído** |
| 3. Comprovar estabilidade sem regressões relevantes nos checks examinados | PRs #250, #251 e #252: **seis workflows aprovados em cada uma**, total de **18 checks**; após merge #252, **quatro workflows de `main` aprovados**, incluindo APK debug e quatro análises CodeQL. O job Kotlin restabeleceu cache e não emitiu aviso Node 20 | **Concluído** |

### Evidências de aceitação pós-merge

Commit `8c43fe91a79729989c359c00c1878ea16092473d`:

- [CodeQL `main` run 43072916396](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916396) — `javascript-typescript`, `python`, `actions` e `java-kotlin` **aprovados**; Kotlin completo em **170 s**. Logs confirmam `checkout@v7`, `setup-java@v6`, `gradle/actions@0723195856401067f7a2779048b490ace7a47d7c`, com **cache hits** Gradle e **sem avisos Node 20** nesse job.
- [APK debug `main` run 43072916394](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916394) — **aprovado** em **114 s de job**, sem disparar assinatura oficial nem publicação.
- [Segurança do repositório run 43072916390](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916390) e [verificação de versão run 43072916523](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43072916523) — **aprovados**.
- [PR #252](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/252): verificações obrigatórias Android, Firestore, versão, dependências, segurança e revisão de escopo, mais as quatro linguagens CodeQL, **todas aprovadas**. Cache mantido e revisão sem discussões de segurança pendentes.

**Cautela estatística:** no período anterior imediato, CodeQL Kotlin em `main` levou 288 s e APK debug 125 s. Os 170 s e 114 s posteriores são apenas **observações pontuais**, não prova causal de que a modernização acelerou o CI. O [comparativo histórico pré/pós](comparativo-pre-pos-actions-2026-11-11.md) com amostra maior permanece **inconclusivo** para aumento geral de velocidade. Não alterar caches, eliminar testes ou contratar runners adicionais apenas com base nesses números.

## Limites assumidos para esta nota

A nota **9,0/10** aplica-se à **maturidade do CI principal** (proteções, testes, paralelismo, documentação, manutenção e estabilidade observada), **não** à rapidez estatisticamente comprovada de todos os pipelines, nem à qualidade do aplicativo Android ou à prontidão para release.

O workflow `.github/workflows/build-apk.yml` **continua** com `checkout@v4`, `setup-java@v4`, `setup-gradle@v4` e `upload-artifact@v4`, e o último log de APK `main` exibiu avisos de depreciação de Node 20. **Não foi modificado**, pois contém a rota de assinatura do release e suas proteções; modernizá-lo exige um ciclo de validação e autorização separado. O sucesso atual não elimina a obrigação de corrigir futuras falhas ou riscos de segurança. Outros workflows de QA/OTA/produção também permanecem fora deste escopo.

## Regra de parada aceita

**Encerrar a otimização discricionária do GitHub Actions ao atingir 9,0/10.** Não continuar perseguindo 9,5 ou 10 por estética, nem promover novas PRs apenas para mudar versões, elevar pontuações ou especular sobre segundos economizados.

Só retomar ações corretivas se houver **falha real, risco de segurança, incompatibilidade futura documentada ou pedido explícito do responsável pelo projeto**. A correção de segurança e a manutenção obrigatória não são impedidas pela regra de parada.

**Resultado:** três critérios concluídos no escopo do CI principal; nenhuma configuração de produção, chave, release, Firebase, Cloudflare, OTA ou backup alterada para alcançar a meta.
