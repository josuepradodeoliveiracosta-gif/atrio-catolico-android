# Firestore CI — compatibilidade Node 22 e auditoria de caches

Data da verificação: 11/11/2026 (UTC). Mudança restrita ao ambiente de testes da PR; **sem deploy, acesso à produção, release, secrets ou mudança de dependências**.

## Evidência real

Os jobs obrigatórios **Regras de seguranca Firestore** nas execuções
[43058988849](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43058988849),
[43057059825](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43057059825) e
[43055122207](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43055122207) passaram usando Node 20, mas seus logs exibiram avisos `npm WARN EBADENGINE` de pacotes que exigem Node >=22 (incluindo `google-logging-utils@2.1.0` e `universal-analytics@0.5.4`).

A presente PR muda **somente `node-version: '20'` para `'22'`** em `.github/workflows/selos-ci.yml` e fortalece o teste offline do contrato. Mantém checkout, Java 17, `npm ci`, todos os testes do Firestore em emulador, testes de preflight, permissões, caches, timeouts, concorrência e compilação Android inalterados. Node 22 já é usado no piloto offline do Guardião; isso não substitui validar este job específico.

## Dados de desempenho e cache

A consulta a **16 jobs CodeQL Kotlin concluídos com sucesso** (7 de PRs e 9 de `main`) mostrou medianas aproximadas:

| Etapa | Mediana |
| --- | ---: |
| Job CodeQL Kotlin | 236,5 s |
| Compilação Android debug instrumentada | 117,5 s |
| Analisar e publicar diagnósticos | 63 s |
| Preparação Gradle | 13 s |
| Preparação do Android SDK | 7,5 s |

Amostra heterogênea, não experimento controlado. Os seis logs CodeQL Kotlin examinados (runs **43058988281, 43058181995, 43057059104, 43055968928, 43052454139, 43037350618**) tinham **acertos de cache Gradle** para dependências e artefatos relevantes, além da distribuição 8.13. Não há evidência de benefício líquido por trocar as chaves ou armazenar artefatos de build mais sensíveis.

Nos três jobs Firestore acima, o setup-node reportou `npm cache is not found`, mas ao fim do job o cache foi **salvo**. A razão de não haver hit entre execuções de PRs distintas, e o benefício de uma eventual semeadura a partir de `main`, ainda precisam ser validados. **Não adicionar jobs de aquecimento, caches globais, permissões ou gatilhos sem uma comparação controlada.**

## Critérios de aceite

- `Regras de seguranca Firestore` com Node 22 aprovado na PR, incluindo a suíte completa.
- `Compilar Android de testes`, CodeQL nas quatro linguagens, revisão de dependências e demais checks obrigatórios aprovados.
- Confirmar nos logs versão Node 22 e ausência dos avisos `EBADENGINE` observados com Node 20. Avisos sobre versões internas de outras actions são assunto distinto e não são automaticamente resolvidos pela seleção do Node usado nos testes.
- Não declarar ganho de velocidade sem medições comparáveis. Se houver regressão na suíte Firestore, não incorporar a mudança.

**Decisão:** manter os caches Gradle e npm existentes; corrigir incompatibilidade de runtime demonstrada, sem alterar a segurança ou a política de execução.
