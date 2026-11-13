# Diagnóstico automático — auditoria de execução QA (somente leitura)

**Estado em 13/11/2026:** amostra selecionada e verificada via metadados
GitHub Actions; não há medição de taxa geral de reparo automático.

## Evidência observada

Amostra **não representativa**, selecionada para testar o contrato de
observação. Não abrange todas as execuções do repositório.

| Run GitHub Actions | Preflight `Analisar receita QA sem escrita` | Job de escrita `Abrir PR draft apenas para receita aprovada` |
| --- | --- | --- |
| [43463548503](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43463548503) | success | skipped |
| [43467162655](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43467162655) | success | skipped |
| [43470376122](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43470376122) | success | skipped |

**O que esses números demonstram:** os três preflights observados funcionaram;
o escritor foi bloqueado/ignorado nos três. **Não comprovam** que existiram
três procedimentos elegíveis, três reparos com falha ou uma taxa de 0% de
autocorreção. A elegibilidade fica desconhecida sem evidência independente.

### Prova manual separada

O [run manual 43464524023](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43464524023)
concluiu com sucesso e criou a PR documental #269 pela GitHub App,
posteriormente integrada após autorização expressa. Essa execução tem evento
`workflow_dispatch`, **não é automática** e deve ser excluída do numerador
e do denominador de automação.

## Ferramenta de auditoria

`scripts/ci_autofix_run_outcomes.py` consulta apenas dois endpoints
padronizados, para cada run informado: `/actions/runs/{id}` e
`/actions/runs/{id}/jobs?per_page=100`. Usa token de leitura do GitHub,
bloqueia redirects com token e confirma repositório, nome/caminho do workflow,
evento, branch, SHA, tentativa, job e conclusão. Rejeita jobs extras,
identidade divergente, paginação incompleta e escrita sem preflight.
Não acessa logs ou detalhes privados de reclamações.

No terminal Android com `gh` autenticado, se desejado, gerar apenas
metadados e resultados locais:

```bash
GITHUB_TOKEN="$(gh auth token)" python3 -m scripts.ci_autofix_run_outcomes \
  --run-id 43463548503 \
  --run-id 43467162655 \
  --run-id 43470376122 \
  --json /tmp/atrio-autofix-runs.json \
  --markdown /tmp/atrio-autofix-runs.md
```

Os argumentos são apenas IDs decimais; não recebe URL, comando, caminho de
receita, conteúdo de log ou identidade de usuário. Nenhuma permissão adicional
foi criada no workflow. Testes inteiramente em memória estão incluídos
no gate já existente `selos-ci.yml`, sem GET durante testes de CI.

## Limites da avaliação

- O auditor não comprova existência de PR, merge, correção efetiva ou
  resultado dos testes de reparo, mesmo se o job escritor terminar `success`.
- `writer_skipped` não equivale a falha de correção. Um preflight verde não
  transforma a execução em caso elegível.
- O SHA histórico do run não comprova atualidade do HEAD da PR.
- Para medir **99%** sobre procedimentos *elegíveis*, será necessário
  pré-definir os critérios de elegibilidade, registrar candidatos e falhas
  de tentativa, verificar independentemente alterações e testes, deduplicar
  por incidente e revisão, e só então calcular numerador/denominador.
- A medição de **90% de causa raiz** exige adjudicação independente em
  amostra representativa; IDs de sinais são apenas indícios.

**Esta etapa não cria worker, banco, PR automática, novos segredos, reruns,
deploy, correção remota, modificação em backup ou merge.** A PR associada
permanece em rascunho para revisão humana e autorização de integração.
