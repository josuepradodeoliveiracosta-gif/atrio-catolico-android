# Ensaio controlado: PR exclusivamente documental — 04/11/2026

**Finalidade:** comprovar em uma PR real o comportamento da [otimização da compilação adicional](CI-ECONOMIA-APK-DOCS.md), integrada na `main` pelo commit `e055ce2a9a234b321d6525de632cf8e763310e20`.

## Escopo deliberadamente limitado

Esta PR altera **somente este novo arquivo Markdown** sob `docs/operacoes/`. Não modifica `app/`, `cloudflare/`, `scripts/`, `tests/`, Firestore, Gradle, assinatura, releases nem os arquivos de workflow.

## Critérios observáveis no GitHub Actions

| Verificação | Resultado esperado |
| --- | --- |
| Job `Classificar PR documental antes do APK adicional` | `success`, com saída `heavy=false` |
| Job `Compilar aplicativo Android` em `build-apk.yml` | `skipped` apenas para esta PR documental |
| `Detectar segredos em arquivos e histórico Git` | `success` |
| `Evitar regressão de versionCode e versionName` | `success` |
| `Regras de seguranca Firestore` | `success` |
| `Compilar Android de testes` | `success` |

**Regra de aceitação:** o projeto só poderá considerar economia efetiva do build extra depois de comprovar a dispensabilidade no job certo e todos os quatro checks obrigatórios. `skipped` para qualquer check obrigatório não é considerado evidência suficiente de segurança.

## Contraprovas e limites

- Esta PR **não** comprova seleção para alteração Kotlin, YAML, Firebase ou Worker. Esses cenários devem continuar `heavy=true` e manter o build extra, conforme testes offline e CI técnica.
- Duração de jobs ou tempo entre `run_started_at` e `updated_at` **não** substitui apuração monetária do GitHub Billing.
- Se o GitHub deixar checks exigidos pendentes, a PR deverá permanecer aberta e não poderá ser integrada por bypass.
- Manter intocados o backup protegido, os Workers oficiais, a exclusão de contas da PR #71, Firebase de produção e a Play Store.

**Estado inicial:** teste de integração documental em andamento, sem declaração antecipada de resultado.

[Plano de economia](CI-ECONOMIA-APK-DOCS.md) · [Inventário de workflows](AUTOMACOES.md).
