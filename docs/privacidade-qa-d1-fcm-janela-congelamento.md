# Privacidade — janela entre marcador D1 e envio FCM (somente QA)

**PR #98 — ambiente isolado | Testes fechados Google Play ainda bloqueados.**

## Risco examinado

O Worker Push original escreve o marcador `delivered` no D1 e só depois executa `fetch` para o FCM. A primeira operação não mantém, por si, um ticket durável que impeça concluir o congelamento de conta antes da segunda. O envio por **tópico** também não conhece todos os aparelhos inscritos; não se pode garantir o respeito ao congelamento por UID com base no nome do tópico.

## Ensaio de coordenação adicionado

`cloudflare/account-deletion-audit/src/qa-push-d1-delivery-gate.js` implementa uma **referência de testes, não produção**. Ela:

1. Aceita exclusivamente `qa-freeze-alice` e `qa-freeze-bob` e identificadores `qa_post`/`qa_reply`.
2. Antes da gravação D1 adquire um ticket SQLite atômico que cobre autor **e** destinatário.
3. Executa somente o `INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)` que já existe no Worker Push, contra um banco fictício.
4. Executa o envio através do adaptador FCM QA preexistente com token fixo de fixture; **não possui cliente externo embutido**.
5. Só encerra o ticket externo depois que o resultado de transporte e a verificação independente simulada confirmam o efeito. Erro, resposta ambígua ou resultado não verificado deixam a operação em aberto e impedem finalizar o freeze.
6. Evento duplicado não gera envio extra. Não permite envio a tópico, UID desconhecido, fallback sem autor, broadcast ou operação arbitrária de D1.

O arquivo `qa-push-d1-delivery-gate.test.js` usa SQLite em memória, D1 compatível e respostas HTTP sintéticas; verifica congelamento antes do marcador, durante a comunicação FCM, reenvio duplicado, erro parcial, tópico recusado e liberação após reconciliação aprovada. Os testes são executados pela suíte existente `privacy-account-portal-ci.yml`.

## Limites de segurança (não homologado para produção)

- **Nenhum Worker foi alterado ou implantado.** O Push real ainda não adquire esse ticket; não há freeze distribuído ativado.
- O mock não comprova entrega pelo FCM: HTTP 200 não significa que o aparelho recebeu uma notificação.
- O D1 fictício não representa IAM, crashes entre bancos distribuídos, fanout com centenas de contas, tarefas agendadas, retries de Worker, tópicos ou dispositivos antigos.
- A verificação de efeitos e o transporte são injetados pelos testes. Um componente de produção precisará de operações com idempotência, reconciliação externa e cercas de geração persistidas num backend autorizado.
- O envio por tópico deve ser desabilitado durante exclusões até existir inventário completo, revalidação de inscrição e teste com contas reais de homologação **não pertencentes à produção**, sem mensagens a aparelhos reais.

`productionIntegrated:false`. A issue #72 e o gate de 9 evidências continuam bloqueando a distribuição. Sem merge, deploy, alteração de `main`, assinatura, OTA ou backups.
