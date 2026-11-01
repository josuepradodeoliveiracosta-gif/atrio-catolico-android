# Átrio Católico — barreira de lease antes da remoção Auth (somente QA)

Data: 31/10/2026. Continuação da PR #93. **Nenhuma conta real é excluída.**

## Problema corrigido

A reconciliação da PR #93 executa consultas assíncronas. O executor
SQLite pode perder seu lease (tempo esgotado e tomado por outro executor)
enquanto uma consulta está em andamento. Anteriormente, o código
removia a identidade Auth **fictícia** e só depois verificava se o lease
continuava válido. Um executor obsoleto poderia concluir um efeito
irreversível, mesmo perdendo o direito de executar.

## Mudança

- `qa-deletion-auth-fence.mjs` funciona apenas no projeto demo,
  host local `127.0.0.1:8089`, UID fixo `qa-delete-alice`,
  sem credenciais reais. Auth é um `Set` de teste, não Firebase Auth.
- Exige lease antes da reconciliação, confirma os campos de evidência
  conservadora e **reconfere lease após a consulta e imediatamente antes**
  da remoção Auth fictícia.
- `qa-deletion-executor.mjs` agora reconfere a posse da autorização
  antes de cada chamada de exclusão de documento da fixture e da
  remoção de mídia em memória.
- `qa-deletion-auth-fence.test.mjs` usa SQLite real com duas conexões,
  relógio controlado e uma consulta artificialmente atrasada. Um
  executor perde o lease para outro e **não pode apagar Auth**.
  Também cobre ausência de freeze, ambiente errado, credenciais
  externas, falha de consulta e comprovação de cobertura insuficiente.
- Workflow de privacidade executa o novo teste automaticamente na
  tarefa com dependências Firebase e marca os arquivos novos como
  gatilhos de CI.

## Limites críticos

Este é um mecanismo de QA e **não é** um controle de produção.
Uma verificação de lease no cliente não invalida uma operação remota
que já saiu em trânsito. A implantação real exige barreira de escrita
**imposta pelo backend** em *todos* os Workers e Firestore Admin,
quiescência comprovada, IAM próprio, geração de fencing persistente,
idempotência, reconciliação em caso de timeout e tratamento formal de
retenção legal antes de excluir Firebase Auth.

O código ainda utiliza Firestore Emulator para dados fictícios,
`Set` para Firebase Auth e Cloudinary, sem qualquer integração
de exclusão com recursos reais. O portal HTTPS de exclusão não
está implantado. A issue #72 continua bloqueando a distribuição Play.

## Preservação

PR isolada, em rascunho, empilhada sobre #93. Não alterar `main`,
APK/AAB, assinatura permanente, OTA, usuários, Cloudflare/Firebase
de produção, Google Play Console nem o backup protegido.

**Readiness:** `productionIntegrated=false`,
`realAccountDeletionEnabled=false`. Avaliar CI antes de mesclar.
