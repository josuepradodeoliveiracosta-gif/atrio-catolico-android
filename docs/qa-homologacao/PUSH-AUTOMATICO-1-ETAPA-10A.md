# Marco 10A — evidências parciais de pré-voo

Evidências do titular em 26/11/2026 (capturas de terminal e painel, sem confirmação independente de métricas da conta):
- gcloud billing projects describe atrio-catolico-qa-general: billingEnabled False. Não repetir nesta sessão.
- Auditoria anterior mostrada no terminal: remoteWrites false, gate review_required, inheritedAndCrossProjectPermissionsVerified false. IAM efetivo permanece pendente.
- Duas capturas do mesmo painel individual de Worker, últimas 24 horas: 37 invocações, CPU Time 11 ms (agregação não identificada), 0 erros. Não somar as capturas. O nome do Worker não aparece no recorte; atribuição ao Worker atual é contextual. Não comprova consumo diário UTC da conta nem CPU do candidato automático. Limite Free 10ms por invocação; examinar agregação/percentis e status Exceeded CPU Time Limits. Não declarar estouro com base nessa captura.
- Cotas D1 da conta, requests da conta e leituras Firestore ainda não recebidas. Cloudflare billing/usage e subscriptions anteriormente 403. Nenhum saldo inferido.

## Alternativa somente leitura para Firestore
Google Cloud Monitoring timeSeries.list, metric.type firestore.googleapis.com/document/read_ops_count, resource.type firestore.googleapis.com/Database, database_id (default), intervalo desde meia-noite America/Los_Angeles até agora. Métrica DELTA, INT64; somar pontos apenas se resposta completa, com dados e sem executionErrors. Sem dados, paginação ou erro => inconclusivo. Não habilitar API, billing ou IAM para conseguir consultar. Painel/Monitoring estima uso; pode omitir consultas vazias, index entries e outros custos. Não tratar diferença 50000 menos leitura observada como saldo exato. Ver https://docs.cloud.google.com/firestore/native/docs/monitor-usage e https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list.

D1: painel da conta, consumo agregado Rows Read/Written desde 00:00 UTC; Worker: requests agregados da conta no mesmo dia UTC. Ver https://developers.cloudflare.com/d1/observability/metrics-analytics/ e https://developers.cloudflare.com/workers/platform/limits/.

GO local 246 testes, NO-GO hospedado. Nenhuma mudança remota, workflow de contrato ou serviço pago. Este registro não é evidência fresca suficiente para ativação; revalidar antes de eventual janela aprovada.