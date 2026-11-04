# QA de exclusão: segunda leitura do Push antes do lote — 04/11/2026

**Escopo:** exclusivamente `demo-atrio-v11`, Firebase Auth/Firestore Emulator local, contas fictícias `qa-push-revoke-alice` e `qa-push-revoke-bob`. Sem acesso a FCM real, Firebase real ou Workers de produção.

## Risco corrigido

O adaptador `qa-push-devices-emulator.mjs` já exigia congelamento do titular, solicitação confirmada, inventário completo e limitado de todos os registros `pushDevices` (inclusive tokens vazios/inválidos) e `lastUpdateTime` em cada deleção de um lote Firestore. Mas uma alteração em um dispositivo do vizinho ou um registro novo do titular **depois da primeira leitura** só seria observada depois do lote; o efeito destrutivo já poderia ter ocorrido.

Agora o adaptador realiza nova leitura de **ambas as contas**, comparando IDs e versões imediatamente antes da criação do lote. Se os inventários diferirem, falha com `qa_push_admin_precommit_inventory_changed` sem excluir nenhum registro do titular. Confere congelamento novamente. A janela inevitável entre a segunda leitura e o commit continua protegida pelas pré-condições `lastUpdateTime`, com commit atômico em Firestore Emulator.

## Testes específicos

A suíte de emuladores exige bloqueio sem efeitos do lote quando:
- um dispositivo do vizinho é modificado após a primeira leitura;
- um novo dispositivo é registrado no titular durante a janela;
- uma edição no titular ocorre **depois** da segunda leitura e imediatamente antes do commit (Firestore CAS rejeita o lote inteiro);
- após remover os fatores de corrida, a exclusão de todos os 27 documentos fictícios do titular funciona, preservando os dois do vizinho e fazendo duas leituras independentes.

Não se usa identificador, segredo ou token de produção. Isso **não** demonstra revogação de tokens FCM reais nem autoriza exclusão na Play Store. A PR permanece draft; `main`, Workers oficiais e backups ficam intactos.
