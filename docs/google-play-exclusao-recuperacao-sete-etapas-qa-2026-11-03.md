# Átrio Católico — retomada segura das sete fases após interrupção (QA)

**03/11/2026 — PR #71 — sem autorização para produção**

## Problema corrigido

O executor de exclusão já guardava as sete fases em um journal SQLite durável com lease/epoch, recusava retomadas sem revisão e só apagava Firebase Auth depois das verificações de Firestore, Avatar/D1 e FCM. Porém, na retomada de um caso interrompido **após** um efeito bem-sucedido e **antes** da gravação do checkpoint, ele voltava a chamar alguns métodos de limpeza. Isso poderia repetir chamadas remotas cuja primeira resposta se perdeu.

## Nova regra

Em \`controlled-executor.js\`, **somente após um epoch de recuperação autorizado (epoch > 1)** e **antes de cada efeito ainda não registrado**, o executor lê o estado por meio do verificador independente da fase. Se o resultado for **exatamente \`true\`**, confirma o checkpoint no ledger sem chamar outra vez o adaptador mutador.

Se o resultado for \`false\`, a ação é executada com as mesmas verificações de autorização, congelamento e lease válidas. Se a leitura lançar erro ou trouxer estado inconclusivo, **o executor para** e deixa o caso ativo para uma nova revisão — não considera a fase concluída. As fases já persistidas continuam sendo verificadas novamente, sem repetição de efeitos.

A etapa \`delete_auth_last\` também usa agora **uma única leitura tri-state** do estado Auth; \`true\` autoriza a chamada do adapter após a verificação; \`false\` não apaga novamente; qualquer outro valor interrompe o processo.

## Matriz de testes

\`cloudflare/account-deletion-processor/src/qa-controlled-executor-recovery-matrix.test.mjs\` executa o executor de verdade contra adapters sintéticos e SQLite **em arquivo temporário descartável** com as mesmas restrições de permissão:

- Injeção de falha **depois** de cada uma das **sete fases** e antes da persistência do checkpoint; todas as fases são retomadas após revisão e reabertura do SQLite.
- Injeção de falha **antes** de cada uma das cinco fases com efeito; o efeito pendente é executado uma única vez após retomada.
- Tentativa de reexecução sem aprovação de recuperação: rejeitada.
- Resposta de revisão não confirmada: rejeitada.
- Verificação remota indisponível após uma aprovação de retomada: falha fechada, sem repetir a remoção.
- Ao concluir, cada uma das cinco ações de mutação é chamada **exatamente uma vez**, a conta fictícia vizinha continua intacta e uma nova execução do caso completo não produz efeitos.

**As respostas dos providers são simuladas**, e a aprovação de revisão é uma função QA, não uma assinatura de identidade de operador real. Os testes não comprovam Cloudinary CDN/backups, revogação FCM no provedor, dados reais de Firestore ou integração durável dos 15 writers implantados.

## Portões não relaxados

PR draft, \`releaseAuthorized:false\`, sem deploy, sem configuração de conta Play Console ou assinatura AAB; nenhuma conta real afetada. O executor é código candidato de QA, não serviço aprovado para produção. Antes da habilitação real, exigem-se IAM separado, autorização de operador, implementação idempotente nos provedores, inventário completo, retenção LGPD e certificação do bloqueio distribuído por serviço.

Esta mudança **reduz retrabalho e risco de exclusão duplicada** depois de falha, mas não transforma um adaptador mal implementado numa prova de exclusão real.
