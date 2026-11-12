# Etapa 5 — Protocolo de avaliação auditável (QA)

Data: 12/11/2026. Integra a PR #259 em rascunho. Nenhuma mudança de produção.

## Escopo e validade

O conjunto docs/ci/datasets/diagnostics-holdout-v1.json contém 13 jobs falhos e 3 controles aprovados. Registra somente IDs, conclusão de job, códigos de sinais observados e revisão humana pendente. Não contém logs brutos, segredos ou dados privados. Foi reservado em relação às sete novas regras, mas não constitui uma amostra cega para todo o classificador.

O avaliador scripts/ci_diagnostic_evaluation.py valida rigidamente esse esquema e calcula cobertura de sinais: 3/13 específicos, 3/13 genéricos e 7/13 inconclusivos. Há 0/13 atestações humanas cadastradas. O número não é taxa de acerto. A precisão de causa raiz é sempre não calculável, porque o classificador não prevê causas comprovadas.

## Procedimento de QA

Executar python3 -m scripts.ci_diagnostic_evaluation com --manifest docs/ci/datasets/diagnostics-holdout-v1.json, --json qa-metrics.json e --markdown qa-metrics.md.

Para classificar uma evidência como human_attested, deve existir revisão humana real com referência registrada no GitHub e sinais aceitos documentados. A rotina offline não verifica autenticidade de quem revisou; não preencher estes campos por inferência do modelo. O conjunto congelado não deve ser ajustado para melhorar números; versões novas precisam preservar a original e declarar a alteração.

Precisão de sinais em casos atestados e precisão de causa raiz são conceitos diferentes. Nenhuma delas deve ser confundida com a cobertura de sinais do classificador. Para demonstrar a meta de 90%, ainda são necessárias causas adjudicadas em amostra representativa e método explícito de mensuração.

## Segurança

Nenhum novo workflow ou gatilho, permissão, token, deploy, reexecução, modificação do app, assinatura, backup ou regra de produção. Os novos testes rodam no gate obrigatório Firestore já existente. PR deve permanecer em draft, sem merge automático.
