# Guardião V2 — próxima etapa de escrita não punitiva (branch isolada)

Data: 31/10/2026. Base: `main` em `79143b27008d5fb5c29fd3124cb6d37ead4cb554`.

## Entrega realizada

- Acrescentado `cloudflare/guardian-worker/src/nonpunitive-write-gate.js` para validar estritamente o lote da primeira triagem automatizada.
- O motor em `src/index.js` aplica a validação antes de `db.commit` quando a decisão NÃO é retenção/quarentena.
- O lote autorizado contém **somente quatro operações atômicas**, nos caminhos previamente calculados:
  1. criar `guardian_cases/{caseId}` com status `review` ou `warned`;
  2. criar `guardian_audit/{caseId}`;
  3. criar `guardian_notices/{ownerUid}/items/{caseId}`;
  4. `verify` da versão original de `posts/{postId}` ou `posts/{postId}/replies/{replyId}`.
- Apenas criação condicionada a `exists:false` e verificação `updateTime` são aceitas. O gate rejeita `delete`, `transform`, `updateMask`, coleções extras, divergência de autor/alvo, ações de retenção e campos não previstos.
- Mantidas as implementações existentes de deduplicação e tratamento de conflitos. Este trabalho não altera o leitor/scheduler de observação.

## Limites desta entrega

**Não existe executor de escrita produtivo ativado.** A barreira de transação NÃO substitui autorização IAM, restrição de permissões por backend, validação de orçamento transacional, política de operação nem supervisão.

O backend Cloudflare continua sem método de identidade produtiva keyless aprovado para escrita; o seu `token()` rejeita chaves JSON permanentes no projeto oficial. O `guardian-v2-runner` continua com papel `roles/datastore.viewer` para observação e não foi ampliado.

O gate é aplicado ao caminho de criação de casos sem retenção. O caminho legado de `hold` permanece protegido pelas aprovações independentes existentes e **não está sendo ativado ou homologado por esta etapa**. Para o primeiro rollout, manter todas as flags de hold desligadas.

## Continuação de engenharia, sem repetir suítes antigas

1. Definir executor efêmero de escrita com identidade **separada**, WIF restrito a repositório, branch, workflow e ambiente. Não reutilizar a conta de observação com privilégios amplos.
2. Implementar orçamento diário durável, atômico e compartilhado entre tentativas/executores, com parada fechada. O limite de 24 execuções do observador não substitui controle de escritas, índices e consumo global.
3. Conectar o executor ao motor sob configuração de produção explícita e modo exclusivamente `review/warn`; não instalar `schedule`, cron Cloudflare nem endpoint de escrita antes de aprovação.
4. Planejar rollback, registros operacionais sanitizados, manutenção de `emergencyStop` e interface administrativa.
5. Somente após revisão e autorização de implantação, integrar à `main` e ativar por estágios.

## Política de alteração nesta solicitação

Atendendo ao pedido de **não fazer mais testes**, não houve execução de testes, builds, ações de observação, operações no Firestore nem abertura de pull request (que poderia disparar CI). Esta branch foi mantida separada da `main`. Nenhum deploy, IAM, Cloudflare, APK, regras Firebase, faturamento ou backup foi modificado.
