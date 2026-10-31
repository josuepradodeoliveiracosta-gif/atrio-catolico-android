# Átrio Católico — Auditoria de imagens antes da exclusão de conta

**Proposta de desenvolvimento, 31/10/2026. Nenhuma exclusão ou consulta a dados reais foi executada.**
Depende das PRs #73 → #74 → #77 → #78. Issue central: #72.

## Descoberta baseada no sistema existente

O `cloudflare/avatar-worker/schema.sql` define quatro tabelas na base D1: `avatar_pending`, `avatar_rate`, `avatar_mutex` e `avatar_moderation`. As fotos aprovadas são referenciadas em `profile_photos/{uid}` no Firestore com `photoPublicId`; as fotos aguardando moderação ficam no Cloudinary como `authenticated`, e as fotos publicadas como `upload`. Seus identificadores seguem o padrão `atrio-avatares/<uid>/<UUID-v4>`.

O armazenamento local `ProfilePhotoStore.kt` também possui fotos privadas, cujo acesso depende do dispositivo. A exclusão remota não garante exclusão de todas as cópias locais ou backups.

## Implementação preparada — sem execução destrutiva

- `avatar-media-inventory.js`: cruza o registro pendente D1, referência Firestore e imagens `upload`/`authenticated` do Cloudinary. Sinaliza fotos sem referência, registro pendente sem imagem correspondente, imagem publicada desaparecida, mudança incompleta de tipo de entrega, mutex ativo, moderação envolvendo terceiros e conflitos de identidade.
- `avatar-d1-read-adapter.js`: consultas preparadas, **exclusivamente SELECT**, somente para as quatro tabelas conhecidas. Identidade de usuário fixa no adaptador, limites e paginação por ID para histórico de moderação.
- `avatar-cloudinary-read-adapter.js`: chamadas administrativas **GET** com `prefix` fixado em `atrio-avatares/<uid>/`, paginadas com `next_cursor` e verificação de tipo de entrega. Exige credenciais injetadas no backend; não admite tokens no aplicativo, em URLs ou no código-fonte.
- Todos os adaptadores retornam apenas dados mínimos (UID, IDs de mídia e estados estritamente necessários) para o contexto interno. O resumo externo contém **somente contagens e códigos de revisão**, nunca URLs privadas, IDs, token ou e-mail.
- `globalMediaCoverageComplete=false` e `safeToExecute=false` por construção. Mesmo se nenhum bloqueio conhecido aparecer, **não há autorização para remover fotos nem contas**.

## Tratamentos que ainda faltam

1. **Não conectar os adaptadores aos Workers ativos antes da homologação.** D1, Cloudinary e Firestore devem ser testados em ambiente exclusivamente fictício e sob credenciais de leitura com privilégios mínimos; não aproveitar credenciais administrativas de produção nos testes.
2. **Adaptador preparado, ainda não homologado contra serviço real:** `avatar-firestore-photo-read-adapter.js` consulta por REST somente o campo `photoPublicId` do documento `profile_photos/{uid}` e rejeita outros campos, donos e respostas malformadas. O teste usa transporte fictício; não existe IAM real nem rota pública para chamá-lo.
3. Localizar mídia antiga fora do prefixo, derivados/cache de imagens, recursos em outros tipos Cloudinary, gravações interrompidas e possíveis tabelas D1 futuras. Nenhuma consulta por prefixo prova cobertura de contas legadas.
4. Moderar retenção de `avatar_moderation`: um caso pode mencionar **dois usuários diferentes**, e não se pode apagar seu histórico por corresponder ao UID de um participante.
5. Definir operação idempotente e recuperável para o futuro processador, com bloqueio de uploads concorrentes; confirmar a exclusão por consulta **após** cada remoção, jamais assumir sucesso por HTTP 2xx.
6. Resolver revogação de tokens FCM, demais subcoleções órfãs, posts e respostas, legislação de privacidade e atendimento efetivo.
7. Só publicar portal HTTPS de exclusão, integrar código e oferecer testes fechados na Play após processamento completo e homologação com contas de QA.

## Segurança e custos

As verificações `node --test cloudflare/account-deletion-audit/src/*.test.js` são offline e não acessam Cloudinary/Firebase/D1. Nenhuma chave privada ou segredo foi adicionada; nenhuma operação de escrita está no novo código. O canal OTA e a assinatura Android permanecem intocados.

Documentação de referência:
- Cloudinary Admin API: https://cloudinary.com/documentation/admin_api (listagem por `prefix`, `type` e cursor).
- Cloudflare D1: https://developers.cloudflare.com/d1/worker-api/prepared-statements/ (consultas parametrizadas).

**Estado:** apenas inventário e verificação preventiva, não exclusão funcional e não conformidade Play completa.
