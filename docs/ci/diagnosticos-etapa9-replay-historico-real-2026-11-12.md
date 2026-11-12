# Etapa 9 — Replay manual e limitado de uma falha histórica legítima (QA)

Data: 12/11/2026. Proposta na PR #259, mantida em rascunho.

## Problema comprovado
O relatório do HEAD `4162eb243d988da11d1a21a53099ed10295ceab7` foi executado manualmente na branch de QA e publicou os cinco artefatos previstos. Como aquele SHA não tinha jobs falhos elegíveis, o fluxo positivo de recuperação/classificação de logs reais **não pôde ser comprovado operacionalmente**.

Foi confirmado via GitHub Actions o exemplo histórico existente:
- SHA `e046f3c3609b8fee5e7b0064646ec174ab3ca2d3`;
- execução `42866978165`, job `130007825671`, `conclusion=failure`;
- check `Testar telas do Átrio — profiles`, `details_url` de job válido;
- o log, inspecionado de forma read-only, contém marcadores de ADB offline e Compose timeout, sem inferência de causa raiz;
- os cinco checks obrigatórios estão `success` naquele SHA, o que demonstra que falha opcional não autoriza reprovação fictícia dos gates.

## Implementação
Foi acrescentado **um booleano opcional e desativado por padrão** ao gatilho `workflow_dispatch` já existente em `.github/workflows/ci-quality-report.yml`:
`qa_historical_replay`.

Quando habilitado **somente no evento manual e na branch exata** `feat/qa-diagnostics-integration-20261112`, o workflow de QA consulta o **SHA fixo** acima em vez de `github.sha`. A opção não aceita run ID, token, URL nem SHA arbitrário. Qualquer tentativa de replay com a opção habilitada fora dessa branch e evento falha antes de consultar a API. O fluxo normal conserva o comportamento anterior.

Nenhum workflow, gatilho adicional, job, permissão ou serviço pago é criado. O token continua com `contents:read`, `checks:read`, `actions:read`, sem persistência no checkout. Todos os relatórios continuam informativos, sem rerun, correção, merge, deploy, publicação ou mudança em produção. Os limites anteriores de 12 candidatos, até três jobs analisados e 2 MB de texto por job permanecem.

## Como homologar após aprovação dos gates do HEAD
1. Em GitHub → Actions → **Relatório consolidado de CI por commit (somente leitura)** → Run workflow.
2. Escolher **Use workflow from: feat/qa-diagnostics-integration-20261112**.
3. Marcar **qa_historical_replay** e disparar uma única execução. Não é necessário criar nova falha ou reiniciar jobs antigos.
4. Confirmar que a execução manual foi criada na branch de QA e usa o HEAD corrente da PR para executar o código; o relatório resultante deverá indicar **SHA histórico `e046f3c...`**, deliberadamente distinto do HEAD da execução.
5. Inspecionar o artefato `ci-readonly-<run_id>`: cinco arquivos esperados; `ci-job-evidence.json` deverá verificar vínculo run/job/SHA/estado/tentativa; `ci-log-signals.json` deverá registrar somente `rule_id` e IDs, sem log bruto. Se a API rejeitar conteúdo, a execução sinalizará `metadata_unavailable` ou `log_unavailable`, sem classificação falsa; corrigir somente após investigar a causa.
6. Verificar que `main`, histórico de backups, Firebase e Cloudflare não foram modificados.

## Critérios de sucesso e limites
- Considerar homologação operacional positiva da classificação somente com prova de que **um job histórico realmente falho foi verificado e classificado pelo workflow**.
- Os sinais observados são apenas evidência de padrões em logs e **não medem precisão de causa raiz**. O conjunto congelado mantém avaliações humanas pendentes; a meta causal de 90% não está demonstrada.
- A PR continua draft e a ativação automática na main, mesmo com QA positivo, depende de revisão e autorização humana expressa. Não usar 100% como sinônimo de acurácia, produção ou aprovação de merge.
