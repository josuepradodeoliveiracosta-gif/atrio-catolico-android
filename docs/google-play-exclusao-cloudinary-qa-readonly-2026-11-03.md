# Átrio Católico — adaptador Cloudinary de leitura QA (03/11/2026)

**Escopo:** PR #71, somente código candidato e testes herméticos. Nenhuma chamada destrutiva, nenhuma mudança em produção.

## Implementado

O módulo `cloudflare/account-deletion-audit/src/qa-cloudinary-readonly-inventory.js` agora lê diretamente o **formato real da Cloudinary Admin API** quando recebe explicitamente um cliente HTTP e credenciais de um ambiente separado. Usa exclusivamente GET para:

- `/v1_1/{qaCloudName}/config`, validando `cloud_name` e `created_at` antes da coleta **e em cada página**;
- `/v1_1/{qaCloudName}/resources/image/{upload|private|authenticated}`, com prefixo `atrio-privacy-qa-20261103/{qa-freeze-alice|qa-freeze-bob}/`, até 25 recursos por página e cursor validado.

O adaptador transforma a resposta real da API em objetos compatíveis com o verificador independente `captureQaExternalBaseline` / `verifyQaExternalReadback`, preservando somente `public_id`, `asset_id` e `type`. URLs são HTTPS fixas e as credenciais **nunca** entram na URL, no resultado ou em mensagens de erro. Há limite de resposta (64 KiB) e validação explícita de identidades, metadados, cursor e completude da página. Um token, UID ou objeto estranho interrompe a prova.

**Guardas de QA:** nome do ambiente de destino obrigatoriamente segue `qa-atrio-privacy-*`; o operador precisa fornecer o nome conhecido do ambiente produtivo, que deve ser distinto. O destino precisa responder `config.cloud_name` idêntico e `created_at` estável. **Esses campos NÃO comprovam isolamento de conta/organização, privilégios de API, backups, originais legados, derivados ou CDN.** O ambiente produtivo informado ainda deverá ser validado de forma independente e os privilégios de credenciais precisam de revisão própria.

O módulo não carrega `fetch` global, nenhum segredo do repositório ou Worker produtivo, e não oferece métodos POST, DELETE, upload, destroy, purge, FCM ou Firebase. O `fetcher` precisa ser fornecido explicitamente por um chamador confiável; isso não impede que outro código externo faça operações indevidas e **não substitui o controle de IAM**.

## Testes e limitações

A suíte `qa-cloudinary-readonly-inventory.test.js` cobre credenciais/destinos inadequados, identidade trocada, cursor e tipo inesperados, falhas HTTP, HTML, excesso de tamanho, recursos de outro usuário, ausência de campos, URLs restritas a GET e integração com o verificador de duas leituras que preserva a conta de controle. Os dados são somente estruturas fictícias; não há chamadas reais à Cloudinary durante a CI.

O banco Cloudflare de QA foi consultado apenas para leitura: Alice permanece `frozen`, Bob `active`, 0 operações pendentes. Os quatro Workers QA continuam privados e sem cron. **Nenhuma conta Cloudinary isolada foi comprovada/conectada**, portanto o adaptador não pode ser chamado com credenciais reais neste momento.

## Requisitos pendentes para homologação externa

1. Confirmar criação e titularidade de ambiente Cloudinary *separado* e sua identidade de produção de forma independente.
2. Usar API key de QA com acesso limitado, segregação de segredos, auditoria e limites; executar as primeiras leituras **sem efeitos de exclusão**.
3. Criar projeto Firebase QA hospedado independente e listar todos os `pushDevices` e outros dados com paginação e evidência completa.
4. Só então implementar os adaptadores destrutivos, com revisão da retenção legal e verificação independente de originais, derivados, backups e CDN.
5. Integrar o bloqueio de escrita em todos os Workers reais, consolidar evidências e manter o Auth por último.

`productionReady:false`, `independentlyIsolatedAccountVerified:false`, `remoteDeletionVerified:false` e `releaseAuthorized:false` permanecem obrigatórios. PR draft; não homologado para apagar usuários reais nem para enviar a Play.

**Fonte técnica:** Cloudinary Admin API, `GET /config` e `GET /resources/image/{type}`: https://cloudinary.com/documentation/admin_api
