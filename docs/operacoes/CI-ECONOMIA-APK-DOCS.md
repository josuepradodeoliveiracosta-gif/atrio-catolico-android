# Otimização conservadora do APK adicional em PRs apenas documentais

**Proposta de 04/11/2026, [Issue #103](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/103).** Esta PR modifica **somente** `.github/workflows/build-apk.yml` para acrescentar um job de análise e evitar **uma compilação APK redundante**, nas raras PRs exclusivamente documentais que a biblioteca fail-closed consegue comprovar. **Não** altera o workflow `selos-ci.yml`, que conserva os checks *Compilar Android de testes* e *Regras de seguranca Firestore*, nem os checks de segurança e versão do GitHub.

## Como funciona

1. Em PR para a `main`, o job barato `documentation_scope` recebe o commit da **base confiável da PR**, não executa código vindo do head do contribuinte e roda os oito testes offline existentes em `scripts/test_ci_documentation_scope.py`.
2. Consulta o ref `refs/pull/N/head` no repositório oficial e compara sua SHA com a SHA imutável fornecida no evento. Desconsidera comparações incompletas, shallow clone, SHAs inválidos ou múltiplas bases de merge.
3. Faz `git diff --raw -z --no-ext-diff` entre o `merge-base` único e a SHA do head, usando o classificador conservador da base. **Somente** adição/edição de arquivo Markdown comum nos caminhos permitidos pode devolver `heavy=false`.
4. O job `apk-firebase` fica dispensado somente quando houve classificação verificável com `heavy=false`. Em caso de erro, ausência de saída, push ou disparo manual, **executa normalmente**.
5. Os workflows exigidos pelo ruleset da `main` permanecem independentes; o ruleset `Protecao-Main-Atrio-Catolico` foi confirmado **active** antes da proposta, com quatro verificações exigidas.

## Casos e resultados esperados

| Evento/alteração | Classificador | Build APK adicional | Checks obrigatórios |
| --- | --- | --- | --- |
| PR só com `docs/x.md`, `design/x.md`, `README.md` ou template Markdown de Issue | `heavy=false`, após confirmação de SHAs | Dispensado | **Todos continuam** |
| PR com Kotlin, Gradle, Workflows, Firestore, Workers, testes, scripts, binários ou mudança mista | `heavy=true` | Executado | Todos |
| PR com arquivo renomeado, symlink, deletado, executável, input malformado ou diff desconhecido | `heavy=true` | Executado | Todos |
| Falha de fetch, SHA alterado, ambiguidades de merge-base ou saída ausente | `heavy=true` ou job com falha | Executado (fail-closed) | Todos |
| Push na `main` ou disparo manual de qualquer branch | Job de classificação dispensado | Executado | Inalterados |
| Disparo manual da `main` com assinatura de release | Job de classificação dispensado | **Mantido exatamente como antes**, inclusive o gate de segredo e a aprovação de backend | Inalterados |

## Validação e limites

- **CI da própria PR técnica** deve compilar normalmente, já que ela modifica um YAML de workflow. Não basta o teste sintático.
- Depois da integração, testar em **PR exclusivamente documental de ensaio**, conferindo que o job `Compilar aplicativo Android` foi dispensado, enquanto *Detectar segredos*, *Evitar regressão de versão*, *Regras de seguranca Firestore* e *Compilar Android de testes* passaram. A seguir, testar uma PR mista para provar o caminho pesado.
- Não marcar a economia como medida até comparar tempos reais de runner (billing) e volume de execuções pós-implantação; `run_started_at` / `updated_at` não são minutos faturados.
- Não alterar a proteção da `main`, gates de publicação OTA, cron do Guardião, credenciais ou backups nesta PR.
- Se GitHub Actions tratar um `needs` dispensado diferentemente do esperado, **reverter** e usar um gate explícito que preserve execução no `push` e `workflow_dispatch`.

**Proteção da branch:** [Issue #109](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/109). **Homologação de exclusão**: [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71), separada e intocada.
