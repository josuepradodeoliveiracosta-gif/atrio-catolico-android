# Homologação — D1 do Avatar e retenção antes de excluir Auth

**PR #98, somente emuladores locais e SQLite descartável.** O executor administrativo fictício passa a exigir `external.d1.assertOwnerCleared(uid)` antes da última operação no Firebase Auth e novamente na verificação final. Um adaptador ausente não pode ser substituído por sucesso presumido.

O adaptador usa a fonte de leitura `createAvatarD1ReadAdapter` e as **cinco combinações** de tabela/coluna já mantidas no projeto: `avatar_pending.uid`, `avatar_rate.uid`, `avatar_mutex.uid` e `avatar_moderation.actor_uid/target_uid`. O esquema SQLite é comparado com o esquema de Avatar conhecido. Uma tabela ou coluna nova bloqueia a operação até nova revisão. Qualquer registro relacionado ao titular, inclusive moderação cujo `target_uid` é o titular, impede a remoção do Auth no ambiente QA, mesmo que o Cloudinary não tenha mais imagens.

Foram acrescentados testes unitários dos cinco casos, conta independente preservada, alteração desconhecida de esquema e configuração de ambiente insegura. O fluxo integrado exercita a existência de uma pendência D1 antes da primeira remoção de Auth; o teste com **Firebase Admin SDK e mesmo UID** inclui um registro de moderação pendente que necessita de revisão. Não há automação de descarte desse registro, apenas simulação da resolução do bloqueio pela fixture.

**Não é decisão jurídica de retenção nem exclusão D1 em produção.** A revisão legal, prazos, auditoria de moderador autenticado, todos os serviços ativos e reconciliação de dados reais continuam abertos na issue #72. Nenhuma mudança na `main`, assinatura, backups, OTA ou Cloudflare/Firebase reais.
