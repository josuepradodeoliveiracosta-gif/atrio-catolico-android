# Privacidade — restrição das escritas D1 de Avatar (QA)

A PR #98 agora chama o Worker Avatar real por um adaptador de testes que valida **cada comando D1 interno**, depois de adquirir o ticket de bloqueio por UID.

O contrato permite somente operações estritamente identificadas de `avatar_mutex`, `avatar_rate`, `avatar_pending` e `avatar_moderation`, conferindo `ownerUid` e `actorUid` diretamente nos parâmetros SQL, inclusive `public_id` do Avatar. Comandos desconhecidos, identificadores de outra pessoa e métodos SQL incompatíveis são recusados antes de consultar o banco fictício.

O fluxo real de upload/status/moderação nos testes continua executado, mas com SQLite local, Cloudinary e Firebase HTTP simulados. O sistema **não integra o Worker implantado** e não protege escritas do Firestore/Cloudinary em produção. Operações administrativas e versões antigas dos Workers precisam de IAM real e barreira persistente comum antes de habilitar exclusão de contas.

Nenhuma alteração da `main`, backups, assinatura, OTA, APK/AAB, Play Store ou credenciais reais. Issue #72 segue aberta.
