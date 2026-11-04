# Exclusão de contas — segunda autorização para repetir efeitos após recuperação (QA)

**03/11/2026 · PR #71 · somente contas fictícias / emuladores.**

## Risco tratado

O executor já proíbe recomeçar automaticamente após uma falha, exige revisão geral do caso e consulta o estado antes de repetir cada fase. Entretanto, uma vez retomado o caso, um resultado **`false`** (por exemplo, mídia ainda presente) levava diretamente à repetição da chamada destrutiva.

Um provedor pode ter aplicado uma operação parcialmente, ter dados em trânsito ou oferecer uma leitura momentaneamente desatualizada. A autorização geral de retomada não comprova que seja seguro repetir cada operação.

## Regra implementada

Em `cloudflare/account-deletion-processor/src/controlled-executor.js`, somente em `epoch > 1`, quando a verificação independente da fase **não confirma sua conclusão**:

- `verify(phase) === true`: registrar o checkpoint sem repetir qualquer efeito;
- `verify(phase) === false`: exigir `backend.approvals.authorizeRecoveryRetry({uid,caseId,epoch,phase}) === true`, com o **nome exato da fase** e o epoch atual, além da autorização do caso já existente; sem esse método, resultado falso ou aprovação revogada, **negar**;
- resultado desconhecido, erro de API ou exceção na leitura: interromper sem repetir o efeito;
- revalidar o lease e a autorização geral depois da autorização específica, imediatamente antes de chamar a operação.

O método `authorizeRecoveryRetry` é **obrigatório quando se pretende repetir um efeito após recuperar a solicitação**, mas não é necessário para verificar um caso concluído ou uma fase que já está confirmada como vazia. Essa decisão deverá vir de um serviço autenticado com credencial de revisão independente e evidência por provedor, não da própria conta que está sendo apagada.

## Provas de QA

A matriz `cloudflare/account-deletion-processor/src/qa-controlled-executor-recovery-matrix.test.mjs` usa SQLite privado temporário e respostas simuladas de providers. Além da matriz de falhas nas sete fases e nas cinco operações, acrescenta três testes:

1. Após recuperar um congelamento já aplicado, a segunda autorização negada impede `purge_firestore` e não cria efeitos novos.
2. A autorização específica para `delete_auth_last` não permite executar `purge_firestore`.
3. Um backend sem `authorizeRecoveryRetry` não pode repetir efeitos depois da recuperação, mesmo se a revisão geral tiver sido aprovada.

**Verificação de três estados adicionada:** o verificador específico de recuperação rejeita resultados ambíguos. Firestore deve confirmar todos os escopos examinados, ausência de referências estrangeiras não resolvidas, retenção analisada, zero escopos desconhecidos e contagem inteira não negativa. Freeze, mídia, FCM e Firebase Auth precisam devolver booleanos explícitos. Uma resposta `undefined`, `null`, string, escopo desconhecido ou erro de leitura **interrompe a recuperação antes de pedir uma autorização para repetir a exclusão**. Quatro cenários adicionais cobrem respostas ambíguas para Firestore, Cloudinary/D1, FCM e Auth. Essa verificação só é adicionada ao caminho de retomada (epoch > 1); as verificações de primeira execução seguem fail-closed.

**Limitações:** nesses testes as autorizações são callbacks QA; não há assinatura de operador independente, IAM do Firebase/Cloudinary remoto, nem certificação de backups, CDN, tópicos FCM e bloqueio em todos os Workers implantados. Os serviços de produção seguem intocados. A regra não garante, isoladamente, segurança de uma chamada remota que já estava em andamento; cada adapter deve impor o próprio bloqueio durável.

**Estado:** PR #71 em rascunho, `releaseAuthorized:false`, nenhuma exclusão de conta real ou autorização de publicação na Play Store.
