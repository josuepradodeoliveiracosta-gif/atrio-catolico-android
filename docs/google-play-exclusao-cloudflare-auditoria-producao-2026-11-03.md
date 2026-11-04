# Átrio Católico — auditoria de produção para exclusão de contas

**Data:** 03/11/2026, leitura em torno de 19:59 UTC. **Escopo:** somente metadados e conteúdo de scripts obtidos pela API Cloudflare, sem ler valores de secrets, linhas de contas ou dados de usuários. **Ação:** nenhuma escrita ou implantação.

## Resultado verificável

A conferência foi feita nos endpoints Cloudflare de configurações de Worker, deployments e conteúdo implantado, além de consultas **apenas de esquema** ao `sqlite_master` do D1.

| Worker em execução | Último deploy observado (UTC) | Texto `account_deletion_freeze` no script ativo | Binding de coordenador de exclusão |
| --- | --- | --- | --- |
| `atrio-avatares` | 2026-10-29 18:45 | Não | Ausente |
| `atrio-guardian-v2` | 2026-10-31 05:17 | Não | Ausente |
| `atrio-push` | 2026-10-27 10:24 | Não | Ausente |

O Push não possui no script ativo a flag `PUSH_BLOCK_SAFE_FANOUT_ENABLED` presente na branch da PR. A inspeção de texto é **indicador de diferença**, não uma prova de proteção ou vulnerabilidade explorável; exige reconciliação do código e dos caminhos de escrita em execução.

Há serviço de estágio `atrio-privacy-freeze-qa-internal`, com binding de D1 dedicado, além dos clientes QA avatar, guardian e push vinculados a ele. Não há vinculação desses clientes fictícios aos três Workers de produção. No D1 `atrio-privacy-freeze-stage-fixtures`, a leitura exclusivamente agregada mostrou **duas contas fictícias ativas**, nenhuma operação pendente, oito nonces e uma execução de smoke registrada. Isso **não comprova** funcionamento com contas reais.

Os bancos D1 de produção `atrio-avatar-control` e `atrio-push-delivery` têm respectivamente quatro e três tabelas operacionais conhecidas. O esquema contém identificadores/estado de avatar, moderação com terceiros e chaves de eventos de push; a política de retenção e o vínculo entre esses registros e cada UID ainda precisam de revisão. Não se consultaram valores dessas tabelas nem linhas de titulares.

## Gate adicional implementado

O módulo `cloudflare/account-deletion-audit/src/deployed-worker-fence-preflight.js` revisa uma observação sanitizada de **todos os três** Workers e nega conclusões parciais: ausência de marcador de exclusão, de admissão durável, de drain de operações pendentes, de coordenador em produção ou de avaliação de entrega FCM individual bloqueia o preflight. Não é um sistema de assinatura/verificação de fonte; metadados podem ser forjados e um resultado estrutural positivo **nunca** autoriza apagar contas, publicar ou assinar.

O contrato propõe um binding `ACCOUNT_DELETION_COORDINATOR` para o futuro serviço `atrio-account-deletion-coordinator`. **Esse serviço não foi criado nem implantado.** É uma especificação candidata a revisão, não instrução automática de modificar bindings ativos. O código de QA atual exige UIDs fictícios e não deve ser simplesmente copiado para produção.

## Bloqueios para homologação definitiva

1. Coordenador real para UID/caso com controle de acesso, idempotência, lease, revogação e drain atômico das operações iniciadas antes do congelamento, integrado em **todos** os caminhos de escrita/cron/fila dos Workers implantados.
2. Reconciliador administrativo com autorização independente, política de retenção revisada e inventário paginado de Firestore, referências cruzadas, exclusão Auth por último, Cloudinary, D1 e FCM com confirmação negativa por provedor e tratamento explícito de respostas ambíguas.
3. Teste real com **conta descartável consentida** em ambiente segregado, evidências privadas e auditoria de não-ressurgimento. Não reutilizar contas ou dados de usuários atuais.
4. Atendimento web/Android, política de privacidade aprovada, Data safety, UGC e requisitos da Play Store comprovados e revisados.

**Estado:** testes Firebase Emulator de exclusão anteriores aprovados. Produção **NÃO homologada**; `releaseAuthorized:false`, nenhuma evidência de privacidade/UGC deve ser promovida a verificada, PR #71 continua rascunho. Nenhuma alteração na `main`, backups, APK de produção, Cloudflare ativo ou Play Console nesta auditoria.
