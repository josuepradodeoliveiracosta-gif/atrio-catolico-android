# Privacidade — checkpoints automáticos do Guardião em QA

A PR #98 passa a testar a varredura paginada real (`scanPagedCycle`) com um adaptador que permite escrever **somente** `guardian_runtime/scan_posts`, `scan_replies`, `scan_reports` e `scan_post_edits`.

O adaptador exige campos fixos, datas ISO, cursores do grupo correto, transições coerentes e versão otimista do checkpoint. Outras gravações pelo caminho `create/update`, inclusive usuários, configurações, casos e métricas gerais, são recusadas.

A moderação dos documentos continua passando pelo bloqueio existente `createQaGuardianCommitGate`, com ticket SQLite por UID. Os testes asseguram que um usuário congelado impede o avanço do cursor da página que falhou, inclusive após reconstruir o adaptador. Uma conta não congelada continua sendo processada.

**Limitação:** a proteção é apenas um adaptador de testes com Firestore falso e SQLite descartável. O Worker implantado não o importa; operações em cron, IAM real, manutenção global do Guardião, concorrência distribuída e recuperação de efeitos externos ainda não foram homologados. A issue #72 segue aberta. Não houve alteração da `main`, do ambiente de produção, do backup, da assinatura Android ou do OTA.
