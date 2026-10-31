# Privacidade — reconciliação remota de mídias órfãs antes do Auth (QA)

**PR #98; somente fixture de Firebase Auth + Firestore Emulator e HTTP local.**

O executor anterior só consultava a mídia conhecida `atrio-avatares/qa-delete-alice/...001`. Isso poderia permitir excluir a conta mesmo quando restasse um segundo avatar órfão, não referenciado no Firestore ou em D1.

O adaptador `createQaCloudinaryHttpAdapter` agora suporta leitura exclusiva no endpoint fictício `GET /qa-owned-assets`, com UID de Alice imutável e varredura das duas modalidades `upload` e `authenticated`. A API valida esquema, dono, tipo, paginação, respostas limitadas e erros HTTP; repete duas vezes a listagem para rejeitar discrepâncias simples. Qualquer imagem restante, falha, paginação incompleta ou resposta inválida **nega a autorização final para remoção no Auth**.

O executor requer `assertOwnerEmpty` sempre que existe adaptador remoto, chama a leitura independente imediatamente antes do Auth e novamente no `final_check`. A reconciliação de Firestore continua separada; o bloqueio de efeitos pendentes dos Workers é mantido.

Testes com o Auth Emulator comum e com o Firebase Admin SDK simulam uma **segunda mídia órfã** da mesma conta, verificam que a identidade continua presente, removem a mídia apenas no estado fictício, e só então retomam o fluxo. O teste de HTTP indisponível também deve falhar fechado. A mídia de Bob permanece preservada.

**Não está pronto para produção:** isto verifica apenas o prefixo e os tipos conhecidos na simulação. O contrato de leitura e o inventário global ainda precisam tratar Cloudinary real, D1, retenção, outros tipos de arquivo, backups, filas antigas e autenticação/IAM antes de habilitar exclusão real. Não há deploy, merge, backup modificado, alteração de assinatura ou OTA.
