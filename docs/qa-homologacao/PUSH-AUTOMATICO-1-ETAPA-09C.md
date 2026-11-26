# Marcos 09C–09E — revisão consolidada antes de uma única CI

## Evidência anterior
CI 09B 45893272379: contrato 197/197, VM 2/2, Workerd 1/1; prova Workerd com 60 registros retidos: 18 chamadas D1, 35 linhas lidas, 14 escritas. Emulador ainda rodava na primeira consulta. Não é métrica hospedada.

## Entregas agrupadas
- 09C: teste integral do relay QA real com adaptador HTTP, Auth/Firestore emulador, D1 SQLite, OAuth/FCM sintéticos, /notice autenticado, evento público bloqueado, replay, desarme e drenagem. Não há cron ou implantação.
- 09D: rejeição estrutural de ID token antes da reserva /notice (RS256, projeto, issuer, UID/email, claims de verificação, senha, iat/auth_time/exp). Claims não autenticam; Identity Toolkit ainda confirma token idêntico, conta e revogação. Tokens plausíveis falsos podem consumir as 200 reservas: proteção externa contra abuso continua necessária. Limite de novas tentativas de rede por prazo interno 45s tick/15s notice (não garante interrupção de chamada já iniciada); antes do FCM, conferir novamente modo/época/prazo no D1, recalcular TTL conforme deadline original, nunca reabrir claim. Contagem FCM marca tentativa no fetch, não mero pedido interno. Duas operações D1 adicionais de rechecagem (uma por tick positivo e uma por notice autorizado) além das reservas de ensaio; máximo conservador 27/13 incluindo os limites prévios, não medição de linhas. Não há atomicidade com FCM.
- 09E: checklist offline de pré-voo, valida evidência recente (15 min), identidade fixa, planos, quotas, versão única e cron ausente, identidade/permissões, segurança e aprovação explícita. Sugestão de margem para ensaio único: 15 mil leituras Firestore, 200 mil linhas D1 lidas, 20 mil escritas, mil requests Workers restantes. Não são limites garantidos: incluem margem prudencial para histórico e tentativas, exigem revisão de métricas da conta. Mesmo com todos os campos verdadeiros só retorna ready_for_human_review, nunca autoriza ativação. Evidências reais não coletadas pelo checklist. Nenhum segredo deve integrar relatório.

## Portão operacional
GO laboratório somente após nova CI. NO-GO hospedado até evidência atual de Free/Firebase sem faturamento, uso compartilhado, identidade efetiva do secret e IAM, revogação real, capacidade e proteção contra abuso, quiescência manual, métricas e autorização específica. CPU de 10 ms e latência ainda não medidas no provedor. Se qualquer gate falhar, preservar modo manual; não pagar para contornar.

## Próximos passos
1. Conferir CI desta revisão e corrigir se necessário.
2. Revisar evidências reais de pré-voo, somente leitura; não habilitar billing, IAM ou cron.
3. Submeter proposta de janela hospedada única e rollback ao titular; apenas depois de autorização específica preparar versão e configuração operacional. Pacote anterior não é publicável sozinho e não tem handler cron. 
4. Medir CPU, consumo, latência e homologar APK46 físico nos dois sentidos. Encerrar e restaurar manual se houver erro. 
Nenhum deploy, merge, cron, SQL remoto, alteração IAM ou serviço pago. Uma única atualização CAS da branch para disparar CI depois de todas as alterações.
