# Integração QA dos diagnósticos — PRs #257 e #258

Data: 12/11/2026. Esta branch usa como base o commit `7698588e37ccd98c72c22ba13559d25d42e73174` da PR #258 e incorpora, **sem merge na main**, os arquivos propostos pela PR #257, com reconciliação explícita do ponto comum `.github/workflows/selos-ci.yml`.

## Por que esta integração é necessária

As duas PRs acrescentam módulos distintos à **mesma linha** de testes do workflow obrigatório Firestore. Testá-las separadamente não prova que a combinação funciona. Nesta branch de QA, a linha é composta para executar os testes do relatório consolidado, do classificador e do reprodutor determinístico, em conjunto.

## Verificação programada

- Reaproveitar o workflow existente `selos-ci.yml`, com os mesmos jobs, gatilhos, limites e permissões de leitura.
- Executar as suítes dos dois incrementos, além dos contratos CI e testes Android/Firestore.
- Executar um teste de integração **offline** dos dois entrypoints originais: `ci_quality_report.main()` com chamada GitHub simulada e `python3 -m scripts.ci_diagnostic_snapshot` em subprocesso. Validar `ci-report.json`, `ci-diagnostics.json`, Markdown combinado e link verificado.
- Confirmar a revisão CodeQL em quatro linguagens, riscos de dependência, verificações obrigatórias e ausência de mudanças em `main`.
- Critério de aceitação: nenhum teste ou check obrigatório falha no SHA da branch de QA. A validação **não** autoriza merge ou deploy.

## Limite operacional importante

Os eventos `workflow_run` executam a definição do workflow presente na branch padrão do repositório. A branch de QA demonstra a compatibilidade dos dois scripts e contratos em ambiente isolado, **mas não prova a publicação do artefato `ci-diagnostics.json` pelo workflow operacional da main**. Não há tentativa de contornar a proteção da main, habilitar SSH, acessar credenciais ou acionar releases. A observação de um workflow com essa versão poderá ser feita somente após um processo de revisão e autorização de integração.

## Regras

- PR de integração exclusivamente em **draft**, sem merge automático.
- Não modificar a `main`, backups, rulesets, secrets, Firebase, Cloudflare, assinatura oficial ou APKs de produção.
- Preservar as PRs #257 e #258 como propostas separadas; eventuais decisões de consolidação são humanas.
- Não expor logs brutos nem dados pessoais nos artefatos.
- A avaliação independente da etapa 5 continua inconclusiva quanto à precisão geral e não recebe aprovação por estimativa.
