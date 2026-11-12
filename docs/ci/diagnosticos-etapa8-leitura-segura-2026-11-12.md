# Etapa 8 — Análise segura e limitada de logs de jobs (QA)

Data: 12/11/2026. PR #259 em draft; **sem integração na main**.

## Fluxo proposto na branch

O workflow existente `.github/workflows/ci-quality-report.yml`, sem novos gatilhos nem permissões, continua:
1. Colhendo verificações por SHA em `ci-report.json`.
2. Construindo `ci-diagnostics.json` com fila de falhas e orientações conservadoras.
3. Consultando somente metadados read-only de run/job para produzir `ci-job-evidence.json`.
4. Para **até 3 jobs cuja identidade foi verificada**, recuperando um arquivo de log individual em memória, limitado a **2.000.000 bytes**, e aplicando as regras determinísticas já existentes em `scripts/ci_failure_classifier.py`.
5. Acrescentando apenas códigos fixos de sinais a `ci-log-signals.json` e `ci-report.md`, nunca linhas ou trechos de log.

## Política de acesso e privacidade

- O endpoint de logs é fixo (`/actions/jobs/{job_id}/logs`); não aceita URL fornecida pelo job. A documentação REST do GitHub informa que a API responde com 302 para uma URL temporária de download.
- A requisição inicial leva token de leitura (`actions:read`), usando cliente sem redirecionamentos automáticos. A segunda requisição só é feita para hospedagem HTTPS de logs GitHub Actions em `*.actions.githubusercontent.com` ou `*.blob.core.windows.net`, **sem cabeçalho Authorization**. Outros destinos são recusados.
- O mesmo cliente sem redirecionamentos vale na segunda requisição. Nenhuma URL assinada, credencial, mensagem de erro da rede ou corpo de log é registrada no artefato.
- Recusas por tamanho, rede, credenciais, identidade, conclusão ou redirecionamento geram códigos estáticos de não classificação, nunca aprovação presumida.
- Sem correção de código, execução de comandos derivados do log, reruns, merge, deploy, alteração de Firebase/Cloudflare, backups ou produção.
- A detecção é de **sinais**, não de causa raiz comprovada. Um job do SHA histórico também não prova que a PR permaneça com aquele HEAD.

## Validação e limitações

- Testes offline em `scripts.test_ci_log_identity_verifier` e `scripts.test_ci_log_safe_analysis` cobrem falsificação de identidade, reruns, limites, redirecionamento sem token, URLs maliciosas, proteção de dados pessoais e processamento fixo de sinais.
- A suíte foi incorporada ao gate obrigatório Firestore e ao teste do relatório. A verificação operacional com falha real depende da existência de um candidato legítimo no SHA consultado.
- O evento `workflow_run` **executa o workflow presente na branch padrão**. Portanto, execução de QA `workflow_dispatch` na branch e aprovação dos gates não autorizam nem comprovam ativação automática na main.
- O cenário sem jobs falhos deve concluir sem download algum. Artefatos informativos não equivalem a permissão de integração.
