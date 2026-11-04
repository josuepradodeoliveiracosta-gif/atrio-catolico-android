# Avatar D1: correção de concorrência em QA (04/11/2026)

Mudança restrita ao módulo `cloudflare/account-deletion-processor/src/qa-avatar-d1-cleanup.js`, executado exclusivamente com Node SQLite em memória e dados sintéticos de `demo-atrio-v11`.

**Falha corrigida:** antes, a exclusão de `avatar_pending` conferia somente `public_id`, permitindo excluir uma versão nova com o mesmo ID após uma leitura remota de Cloudinary. `avatar_rate` era apagado sem comparação de `next_at`; a aprovação inicial também podia ficar desatualizada caso surgisse um mutex ou retenção durante o readback.

**Proteção:** a consulta inicial captura `public_id`, `created_at` e `next_at`. Antes de cada efeito compara a versão da taxa e verifica mutex e moderação; a instrução SQL de remoção também exige `created_at` exato ou `next_at` exato, `NOT EXISTS` de operação em andamento e `NOT EXISTS` de moderação. Registros criados ou alterados durante o readback não são removidos. Uma falha aborta a limpeza e requer reconciliação nova para retomar.

**Testes:** mesma mídia com nova versão, `avatar_rate` alterado, taxa inserida tardiamente, mutex e retenção adicionados depois da prova de Cloudinary, e reexecução idempotente sem taxa inicial. A conta vizinha é preservada.

**Limites:** isso não comprova nem realiza exclusão em Cloudflare D1 real, Cloudinary real, Firebase real ou IAM de produção. Não modifica Workers, Play Store, backups ou `main`.
