# Átrio Católico — autorizações de recuperação assinadas, descartáveis e persistentes (QA)

**Data: 03/11/2026 · PR #71 em rascunho · não implantado**

## Lacuna de segurança corrigida

O executor já exigia aprovação geral do caso e uma segunda aprovação específica para uma fase que necessitasse de repetição. A segunda aprovação, contudo, era apenas uma interface de callback; não existia um formato comprovadamente assinado nem proteção persistente contra a reutilização de uma autorização.

O novo módulo **`cloudflare/account-deletion-processor/src/qa-signed-recovery-review.js`** fornece o mecanismo criptográfico somente para QA. Ele **não possui chave privada**, código de Firebase/Cloudinary/FCM, rede ou mecanismo de publicação.

## Contrato

Uma autorização é um documento canônico assinado com **Ed25519**, incluindo versão do protocolo, finalidade (`case_resume` ou `phase_retry`), projeto `demo-atrio-v11`, identidade do revisor fictício, UID sintético, ID imutável da solicitação, **epoch**, fase, nonce UUID, início, expiração e **SHA-256 dos checkpoints persistidos**.

- O verificador conhece **somente a chave pública** configurada. O teste gera um par de chaves temporárias em memória; não há chave privada real no GitHub.
- As autorizações são aceitas somente dentro de uma janela de até **cinco minutos**, com validação de emissão e expiração, e só para as identidades artificiais autorizadas.
- A assinatura é verificada sobre bytes canônicos que incluem cada dimensão acima. Alterar titular, solicitação, etapa, epoch, identidade do revisor ou checkpoints invalida o documento.
- Após validar assinatura e prazo, o módulo abre **transação SQLite BEGIN IMMEDIATE**, confirma que o journal da mesma conta/solicitação/epoch está ativo e que o próximo checkpoint corresponde à fase, e **registra o uso da autorização antes de permitir o efeito**.
- O recibo é persistente por nonce e **único por conta + solicitação + epoch + finalidade + fase**. Um novo token para a mesma etapa não pode substituir o token já utilizado. Reinicialização ou concorrência não liberam novamente o efeito.
- O journal original continua exigindo SQLite privado descartável e somente tabelas/colunas reconhecidas; a tabela adicional `qa_signed_reviewer_receipts` foi incluída explicitamente nessa lista restrita.
- Um erro ou timeout depois de consumir a autorização deixa a permissão consumida, sem tentativa automática de repetição. É necessário novo processo de revisão e epoch, com verificações independentes.

## Verificação automatizada

A suíte `qa-signed-recovery-review.test.mjs` cobre autorização assinada de retomada geral do caso, token de fase consumido uma única vez, persistência após reabrir SQLite, assinatura adulterada, outra identidade/conta/caso/fase/epoch, checkpoint diferente, prazo inválido, tentativas concorrentes, banco não autorizado e integração com o **executor real** em QA.

A integração final assina fora do executor (somente dentro do teste) as permissões para `purge_firestore`, `purge_media_and_d1`, `revoke_fcm` e `delete_auth_last`, cada uma vinculada ao checkpoint esperado. O executor retoma uma conta artificial e as utiliza uma única vez; a outra conta fictícia permanece intacta. Um restart valida a ausência de novos efeitos e de consumo adicional.

## Limitações e proibições

**Assinatura válida não comprova que quem assinou foi um operador humano autorizado.** Para produção são necessários IAM separado, custódia e rotação de chaves, assinatura realizada fora do processo de exclusão, auditoria imutável, revisão de evidências reais de Firebase/Cloudinary/FCM, retenção e integração do bloqueio nos Workers produtores. O módulo de QA ainda aceita um par de chaves **gerado no próprio processo de testes**, e portanto não comprova isolamento organizacional ou de credenciais.

Nenhum Worker de produção recebe esse código, nenhuma exclusão de conta real é autorizada, e a distribuição Google Play continua **NO-GO** até homologação externa. O gate `releaseAuthorized:false` e a PR draft devem permanecer.

**Próximo marco:** usar um revisor remoto de QA efetivamente separado com chave pública pinada e identidade verificada, sem transportar a chave privada para o executor, antes de qualquer teste remoto de exclusão de contas descartáveis.
