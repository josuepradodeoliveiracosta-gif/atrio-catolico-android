# Firestore Emulator: duas leituras independentes antes de qualquer exclusão — 04/11/2026

Implementação segregada na branch de homologação do Átrio Católico, PR #71 (draft), projeto `demo-atrio-v11`, somente Firebase Admin SDK conectado aos emuladores em `127.0.0.1`.

## Problema

A limpeza administrativa de descendentes do titular e a limpeza restrita de referências estrangeiras tinham uma enumeração inicial antes de começar a remover documentos. Mesmo com precondição de versão em cada `delete`, um novo descendente ou nova referência podia aparecer entre o inventário inicial e a primeira exclusão; a alteração seria detectada apenas no fim, depois de efeitos parciais.

## Correção

- **Descendentes:** executar uma segunda enumeração completa e limitada dos caminhos do titular antes da primeira exclusão. Uma nova árvore, um órfão ou um caminho removido provocam `qa_owned_descendant_purge_precommit_tree_changed`. Cada documento ainda é relido e apagado apenas com `lastUpdateTime` condicional do Firestore.
- **Referências em terceiros:** repetir o inventário das notificações de sistema e preferências de bloqueio antes da primeira exclusão e comparar IDs **e timestamps de atualização com precisão de nanossegundos**. Qualquer alteração de conjunto ou versão produz `qa_foreign_reference_cleanup_precommit_inventory_changed`. As precondições individuais de versão e o inventário final continuam obrigatórios.
- **Limitação explícita:** uma modificação entre a segunda leitura e o primeiro `delete` ainda pode acontecer. As proteções CAS por documento e o fence por fase reduzem o risco, mas não fornecem atomicidade global; operações parciais após o início exigem revisão, nova autorização e nova enumeração antes da retomada.

## Evidências adicionadas

Testes reais com o Firestore Emulator criam um descendente novo ou alteram/adicionam notificação no exato intervalo entre as duas leituras. Eles exigem falha **antes da primeira exclusão**, preservação do documento original e preservação de Bob. Nenhuma conta real, provedor Cloudinary/FCM real, Worker oficial, backup ou Play Console é tocado.

Esta alteração não autoriza publicação nem execução de exclusão em produção.
