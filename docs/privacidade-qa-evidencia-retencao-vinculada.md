# Privacidade — comprovante de retenção de QA, inválido após novo caso

A PR #98 agora inclui um comprovante de retenção separado, **apenas em SQLite descartável e emuladores**, além da ordem administrativa estática já usada nos testes.

**Regra:** o comprovante é vinculado ao UID fictício, ao instante exato da solicitação, às duas identidades fictícias de revisão, à validade temporal e à geração das pendências. Uma nova pendência de moderação/investigação ou sua resolução altera a geração e invalida a aprovação anterior. Revisões expiradas, com outra solicitação, sem ambos os revisores ou com retenção ativa não autorizam avançar. Um caso que foi resolvido requer **nova aprovação**: a antiga não é reutilizável.

O executor administrativo verifica esse comprovante na entrada de cada tentativa, inclusive após retomada; a etapa imediatamente anterior ao Auth e a checagem final fazem nova leitura. A consulta independente do D1, Cloudinary e Firestore continua obrigatória. Evidência não encontrada ou inválida impede alterações irreversíveis.

**Limites importantes:** os revisores são apenas IDs de fixtures; não existe login real, assinatura digital, decisão jurídica ou política de prazo aplicada em produção. A integração real exige autenticação administrativa, registros imutáveis e consulta a retenções legais antes de habilitar a exclusão. A issue #72 permanece aberta. Nada é implantado e `main`, backups, assinatura e OTA não são alterados.
