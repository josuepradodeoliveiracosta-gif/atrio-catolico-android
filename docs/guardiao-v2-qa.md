# Átrio Guardião V2 — validação integrada em QA (29/10/2026)

## Execução preparada

A implementação está em `feature/guardiao-autonomo-20261029`, PR #44 (rascunho). Foi criada exclusivamente a instância **`atrio-guardian-v2-qa`** na conta Cloudflare do projeto; os Workers `atrio-push` e `atrio-avatares` não foram editados.

Esta instância usa módulos reais do motor V2 da branch de testes, com as seguintes variáveis verificadas por leitura da API Cloudflare:

```text
GUARDIAN_V2_TEST_MODE=true
GUARDIAN_V2_ENABLED=false
GUARDIAN_V2_HOLD_ENABLED=false
```

Nenhum Firebase secret, token administrativo ou conexão privilegiada foi adicionado. O modo QA bloqueia todas as rotas administrativas (`503 qa_read_only`) e impede varredura do Firebase mesmo se as flags forem alteradas acidentalmente. Apenas a rota `GET /health` é acessível sem credenciais. A URL exclusiva de testes foi habilitada; a resposta HTTP pública ainda exige verificação de alcance externo.

O cron Cloudflare **`*/15 * * * *`** foi configurado via API somente no Worker QA. Seu comportamento, enquanto `GUARDIAN_V2_TEST_MODE=true`, é emitir apenas o log técnico `guardian_v2_qa_cron_tick` sem contato com Firebase. **Não equivale a moderação autônoma em produção.** Confirmar pelo histórico de invocações da Cloudflare que o primeiro disparo agendado ocorreu; criação do Cron, por si só, não comprova execução efetiva.

## Testes automatizados do código

`cloudflare/guardian-worker/src/guardian.test.js` cobre regras, casos, duplicidade, reversão, conflitos, fraude por denúncias e limites de intervenção.

`cloudflare/guardian-worker/src/qa-integration.test.js` acrescenta testes do modo QA fail-closed, handler agendado, consulta Firestore via REST simulada, collection group e precondição de concorrência REST.

`tests/security/guardian-v2.test.mjs` testa permissão e isolamento dos documentos no Firestore Emulator. A compilação Debug é validada pelo GitHub Actions; a Release assinada não é produzida neste workflow.

Os testes com REST simulado **não são** chamadas a Firebase em produção e não comprovam os papéis IAM ou a autenticação real.

## Condições obrigatórias antes de qualquer teste com Firestore remoto

1. Criar e confirmar um **projeto Firebase/Firestore de QA diferente de `atrio-catolico`**, exclusivamente para contas fictícias e dados sintéticos. O adaptador já aceita a escolha explícita de projeto `GUARDIAN_FIREBASE_PROJECT_ID` e bloqueia acesso ao projeto de produção sem `GUARDIAN_V2_PRODUCTION_APPROVED=true`. Ainda é necessário criar o projeto QA e validar a identidade técnica antes de usar credenciais.
2. Definir identidade técnica específica do QA com permissões mínimas e testar negativas de escrita/leitura. Atenção: credenciais Admin SDK contornam as Security Rules clientes; validar IAM no backend.
3. Confirmar índices de `collectionGroup(replies)`, capacidade de paginação e recuperação de janelas quando houver mais de 30 documentos por consulta.
4. Simular retenção reversível, restauração, duplicidade, erro HTTP 400 `FAILED_PRECONDITION`, falha de rede, recurso e disputa simultânea dentro do projeto QA, com auditoria completa.
5. Revisar privacidade, minimização dos registros e expurgo de evidências antes de permitir dados reais.
6. Somente com autorização explícita e nova auditoria desabilitar o modo QA, configurar endpoints reais ou aplicar intervenções. Nenhuma punição real foi autorizada aqui.

## Interrupção de emergência

No QA não há ações possíveis. Em um ambiente posterior, desligar tanto `GUARDIAN_V2_ENABLED` no Worker quanto `guardian_config/policy.enabled`, e definir `emergencyStop=true`. Suspender o agendamento Cron se necessário. Não confiar apenas no botão Android.

## Registros de alterações protegidos

Não houve merge na `main`, mudança de backup, modificação do Worker de notificações, publicação das regras Firebase nem Release assinada.
