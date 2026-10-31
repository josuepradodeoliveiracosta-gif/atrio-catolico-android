# Átrio Católico — bloqueio de novas escritas durante exclusão (QA)

**31/10/2026. Proposta não implantada.** Depende da PR #83, que depende de #82 → #81 → #80 → #79 → #78 → #77 → #74 → #73. A issue #72 permanece aberta.

## Objetivo e comportamento implementado em proposta

`firestore.rules` adiciona `account_deletion_freeze/{uid}`. Este marcador é **criado e retirado apenas por um backend administrativo confiável** via Admin SDK; o aplicativo e o portal web não podem criar, editar, excluir nem listar marcadores. O próprio titular pode consultar o seu marcador (para, futuramente, receber uma mensagem apropriada). A simples criação de `account_deletion_requests/{uid}` **não congela** a conta e não aciona exclusões.

Quando o marcador está presente, a regra `accountWritable(uid)` impede os clientes Firebase de criar ou alterar conteúdo do próprio titular e novas referências associadas a ele. Abrange publicações, respostas, reações, perfis públicos/privados, selos autodeclarados, solicitações de selo, acompanhamento, curtidas, favoritos, registros FCM, denúncias e alteração de notificações. Evita que terceiros adicionem novas respostas, reações, curtidas ou acompanhamentos a conteúdo cujo autor esteja congelado e bloqueia notificações destinadas a uma conta congelada.

Permanece permitido **ler o perfil e os dados acessíveis e consultar a própria solicitação**. Administradores que agem como clientes Firebase continuam sujeitos às regras normais dos privilégios administrativos. As operações do Admin SDK ignoram as regras e exigirão barreiras independentes.

## Testes integrados

`tests/security/account-deletion-freeze.test.mjs` roda no Firestore Emulator com dois UIDs fictícios. Exercita ações antes e depois do marcador, as restrições de leitura/escrita, a proteção contra referências cruzadas e a restauração administrativa do acesso no emulador. O Workflow existente de privacidade executa o novo teste sem acesso a serviços reais.

## Limites críticos para produção

**Não mesclar nem implantar o marcador como bloqueio completo de produção nesta etapa.** Esta camada somente cobre escritas provenientes de clientes Firebase sujeitos a Security Rules. Não bloqueia:

- Admin SDK / Firestore REST com identidades administrativas de Worker (inclusive Guardião, envio de notificações e upload de mídia);
- Cloudinary, Cloudflare D1 ou armazenamentos locais dos aparelhos;
- caches e requisições em andamento antes do freeze, nem novas escritas de sistemas externos;
- publicação de mídia, operações de backend ou processos automáticos que contornem Firestore Rules;
- dados históricos e subcoleções desconhecidas não auditadas.

É obrigatório integrar a verificação de freeze **nos backends que gravam dados**, com bloqueio serializado e prova de ausência de novas gravações antes de permitir a fase de exclusão do Auth. Para uma garantia distribuída real, é preciso um protocolo de quiescência/fencing por serviço — um marcador Firestore isolado não oferece operação atômica abrangendo Cloudinary e D1. Também exige tratar a contagem de consultas extras e possíveis limites das Security Rules; o emulador valida funcionalidade, mas não comprova custos/cotas reais.

Outro cuidado: o marcador tem de ser mantido durante o processamento e nunca removido antes de uma decisão autorizada. Cancelamentos requerem política e auditoria; após concluir, apenas um comprovante mínimo deve permanecer pelo tempo permitido pela política de privacidade.

## Status

Nada foi publicado ou implantado. Sem APK/AAB, alteração de chaves, backups ou contas reais. O processo de exclusão ainda não está operacional; página web e processador completo permanecem pendentes.
