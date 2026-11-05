# Classificador de CI para documentação — contrato offline (04/11/2026)

Esta etapa implementa **somente a biblioteca e os testes offline**. Nenhuma automação usa o classificador ainda; os workflows de Android, Firestore, Guardião, segurança e publicação continuam com os mesmos triggers. A proposta é parte da [Issue #103](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/103) e da auditoria de [300 execuções](RELATORIO-CI-2026-11-04.md).

## Como validar sem executar Actions

```bash
python3 -m unittest discover -s scripts -p 'test_ci_documentation_scope.py' -v
```

Em execução futura controlada, o chamador deverá calcular a comparação **completa de dois SHAs fixados**, da base e do HEAD de uma pull request, com:

```bash
git diff --raw -z --no-ext-diff BASE_SHA HEAD_SHA > diff.raw
python3 scripts/ci_documentation_scope.py \
  --raw-diff-z diff.raw --event pull_request --comparison-verified
```

**Não interpretar** a flag `--comparison-verified` como comprovação por si: o workflow que usar esse módulo precisará validar origem, ref/evento, SHA, ancestralidade/merge-base conforme política, `git diff` exit code e ausência de truncamento. Também terá de revisar os status checks exigidos e manter verificações obrigatórias presentes mesmo quando um job pesado não for necessário. Não aplicar diretamente `paths-ignore` que deixe um check exigido eternamente pendente.

## Contrato de segurança

- Sem comparação confiável, sem entradas, erro de leitura, evento não-PR ou diff malformado: `heavy=true`.
- A única exclusão candidata a jobs pesados é um conjunto composto **inteiramente** de arquivos Markdown normais (`100644`) sob `docs/`, `design/`, `.github/ISSUE_TEMPLATE/` ou o `README.md` principal.
- Mudança mista, Gradle, Kotlin, Firebase, Worker, scripts, testes, workflows, imagens, JSON, YAML ou arquivo desconhecido: `heavy=true`.
- Arquivos deletados, renomeados ou copiados, submódulos, arquivos executáveis ou symlinks: `heavy=true`, mesmo com extensão `.md`.
- Tamanho anormal, nomes duplicados, caminhos relativos ambíguos, Unicode de controle, caractere de nova linha e metadata inválida: `heavy=true`.
- É uma **proposta de seleção**, não um gate ativo. Sem mudança em segredos, cron, firma de APK, produção ou Play Store.

**Revisão pendente:** antes de conectar o script a qualquer workflow, aprovar a matriz de regressão, testar uma PR de ensaio e medir a cobertura e o impacto nos checks obrigatórios.
