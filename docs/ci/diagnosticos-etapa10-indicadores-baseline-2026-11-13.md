# Indicadores do diagnóstico automático — linha de base auditável (QA)

**Data:** 13/11/2026. **Escopo:** somente testes e mensuração offline; sem operação remota.

## Por que esta etapa é necessária

O projeto já possui um diagnóstico de CI por SHA, confirmação de identidade de
jobs, triagem de logs limitada, propostas de correção e uma prova real **manual**
e restrita de criação de PR documental pela GitHub App. Esses componentes não
demonstram, por si, precisão de **causa raiz** ou uma taxa de **autocorreção
automática de 99%**.

As PRs históricas #257 e #258 estão abertas, mas o código correspondente na
`main` já evoluiu; não fazer merge direto dos patches antigos sem reconciliação.
A correção de validação de IDs está isolada na PR #271.

## Fonte e denominadores

A fonte única deste relatório é o conjunto existente
`docs/ci/datasets/diagnostics-holdout-v1.json`, validado por
`scripts/ci_diagnostic_evaluation.py`.

| Medida descritiva | Resultado |
| --- | ---: |
| Jobs históricos da amostra | 16 |
| Jobs com falha | 13 |
| Controles com sucesso | 3 |
| Falhas com sinal específico | 3/13 (23,1%) |
| Falhas com qualquer sinal, inclusive genérico | 6/13 (46,2%) |
| Falhas inconclusivas | 7/13 |
| Revisões humanas declaradas | 0/13 |
| Precisão de causa raiz | **Não calculável** |
| Taxa real de autocorreção sobre casos elegíveis | **Não calculável** |

O *holdout* foi reservado somente em relação a sete regras adicionadas, não
é uma amostra cega para todo o classificador e não oferece um gabarito de
causas comprovadas. A cobertura observada não é taxa de acerto, recall causal
nem promessa de desempenho em produção.

### Comando reproduzível

```bash
python3 -m scripts.ci_diagnostic_kpi_baseline \
  --manifest docs/ci/datasets/diagnostics-holdout-v1.json \
  --json /tmp/qa-diagnostic-kpi.json \
  --markdown /tmp/qa-diagnostic-kpi.md

python3 -m unittest \
  scripts.test_ci_diagnostic_evaluation \
  scripts.test_ci_diagnostic_kpi_baseline -v
```

O relatório inclui SHA-256 da entrada para identificação da amostra, aceita
somente denominadores coerentes e rejeita declarações artificiais de acurácia
causal ou autenticidade de revisões humanas. Nenhum arquivo da amostra pode
ser sobrescrito por saídas do programa. Os testes estão no gate obrigatório
existente de Firestore; não foi criado novo workflow nem permissão.

## Requisitos para demonstrar os objetivos futuros

**Meta de 90% de diagnóstico causal:** definir causas verdadeiras por revisão
independente em casos representativos não usados para montar as regras;
medir erros, abstenções, precisão e cobertura; confirmar identidade dos jobs
e preservar acesso restrito às evidências.

**Meta de 99% de automação elegível:** aprovar previamente quais procedimentos
são elegíveis e seguros, fixar denominador por período e versão, verificar a
execução bem-sucedida de cada procedimento e suas falhas/reversões. Nenhuma
proposta, preview de sandbox, execução manual one-shot ou check verde deve ser
contado como correção automática geral.

**Fronteiras:** nenhum merge, deploy, leitura de logs brutos, contato com
Firebase/Cloudflare/produção, edição de backup, senha, segredo, rerun ou
alteração de dados reais. Esta etapa não libera o Guardião, chat ou moderação.
