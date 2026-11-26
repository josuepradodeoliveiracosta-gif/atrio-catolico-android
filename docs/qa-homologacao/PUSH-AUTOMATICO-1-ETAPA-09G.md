# Marco 09G — correção Workerd e relatório offline de pré-voo

CI 09F 45894428594: contrato 203/203, VM 2/2, probe Workerd aprovado; teste do entry gerado falhou antes de execução com ERR_MODULE_PARSE em qa-geral.js. Emulador ainda em execução na consulta. Correção somente no harness: regra modulesRules ESModule para .js, conforme https://developers.cloudflare.com/workers/testing/miniflare/core/modules/. Miniflare por padrão classifica .js como CommonJS. Mantido nodejs_compat para o relay legado e data de compatibilidade suportada pela versão local. Nenhuma alteração do Worker implantado. CI nova pendente.

## Pré-voo executável
Da raiz do repositório, sem rede:
```sh
node cloudflare/push-worker/scripts/qa-automatic-preflight-report.mjs --template > /tmp/atrio-preflight.json
node cloudflare/push-worker/scripts/qa-automatic-preflight-report.mjs /tmp/atrio-preflight.json
```
O template é deliberadamente bloqueado. Preencher somente evidências reais de console/auditoria, observadas nos últimos 15 min (observedAt em epoch ms). Não inserir tokens, chaves, credenciais ou capturas de conteúdo privado. Relatório imprime apenas resultados dos checks, não os valores de entrada. Código de saída 2 bloqueado, 1 inválido, 0 template ou pronto para revisão humana. Nenhuma saída autoriza ativação; as afirmações do operador não são verificadas independentemente.

## Coleta mínima de evidências (somente leitura)
- Cloudflare: plano Workers Free e saldo diário de requests; D1 saldo de rows read/written (conta, UTC), versão única atual, cron vazio, binding QA; console se API negar. Usar saldo, não consumo. API de assinatura retornou 403 no marco 09F.
- Firebase QA: saldo diário Firestore (Pacific) e billingEnabled false; em Debian, comando somente leitura: gcloud billing projects describe atrio-catolico-qa-general --format="value(billingEnabled)". Não mudar faturamento para conseguir ler.
- IAM: conta dedicada do secret atual, permissões efetivas, sem escrita Firestore; verificar heranças, grupos e deny. Não exibir ou rotacionar chave. Auditoria anterior incompleta.
- Autenticação real, dispositivos QA, proteção antiabuso, métricas, quiescência manual e ausência de pendência, plano de rollback e aprovação específica. Não marcar true por suposição. 
- Margens internas: 15000 leituras Firestore restantes, 200000 linhas D1 lidas restantes, 20000 escritas restantes, 1000 requests Workers restantes. Se os dados não puderem ser confirmados, manter NO-GO.

Não há autorização para implantação, cron, mudança de IAM ou SQL remoto. O relatório local não comprova CPU hospedada, FCM físico ou operação automática. Após CI verde, preencher evidência de console e revisar proposta de janela hospedada com autorização explícita. Agrupado em um único commit e uma atualização CAS.
