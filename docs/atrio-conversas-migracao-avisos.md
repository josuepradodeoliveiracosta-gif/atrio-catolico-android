# Átrio Conversas — proposta de migração das notificações

**Situação (08/11/2026): PROPOSTA, não implantação.** PR #193; issues #201 e #200.

## O que já sabemos
Cinco execuções de QA dos três bots passaram após exigir confirmação
das gravações no Firestore. A origem retrospectiva da intermitência não
ficou provada; não há confirmação de entrega real de FCM por esses testes.

O app atual grava resposta e aviso no mesmo batch. As Rules existentes
protegem a criação do aviso, mas permitem ao cliente legado gravar só
uma resposta. Não modificar regras produtivas sem transição controlada.

O OTA oficial **rejeita manifestos mandatory=true** e depende da
confirmação de instalação pelo Android. Não é hoje um mecanismo de
atualização obrigatória. minimumAndroidSdk não equivale à versão mínima
do aplicativo. Um cliente pode falsificar campos de versionCode.

Main consultada no SHA ae939a0e1658e86b714695e3b1514c992db86bef:
app/build.gradle.kts indica versionCode 39 e versionName 0.20.4.
Isso não comprova a versão instalada no aparelho.

## Prova de conceito exclusivamente em emulador
tests/security/reply-notice-migration-lab.test.mjs injeta em memória
uma regra candidata sobre uma cópia das Rules. Não modifica firestore.rules.

A regra experimental consulta um documento administrativo hipotético:
app_config/reply_notification_policy, com enabled true/false.
- Ausente ou false: aceita respostas sem aviso para compatibilidade.
- true: resposta de terceiro exige aviso canônico ao autor do post
  no mesmo batch e impede forjamento de avisos.
- Resposta do autor ao próprio post não requer autoaviso.
- Desativar a flag faz rollback, mas reabre o risco de aviso ausente.

O laboratório expandido demonstrou 17/17 testes aprovados no commit
fde7081: avisos para destinatários de respostas diretas e participantes
mencionados, incluindo deduplicação com o autor do post e bloqueio de escritas
sem aviso. Isso é prova em Firestore Emulator, não deploy. O laboratório
também exige avaliação contínua dos limites e custos de leitura das Rules.

Em 08/11/2026 a auditoria read-only dos APKs reais v0.20.3/code38 e
v0.20.4/code39 passou no GitHub Actions #42493289737: SHA-256 calculado,
manifestos, certificado oficial, applicationId e versão. As duas tags
publicadas contêm o mesmo OnlineAtrioApp.reply() que escreve batch de
resposta e avisos, mas sem congelar a identidade da sessão antes da leitura
assíncrona do autor do post.

Próximos testes incrementais (20/20 aprovados no workflow GitHub Actions #42494784528): payload de resposta direta
a comentário do próprio autor da resposta, rejeição atômica de target e
mention simultâneos (ambos podem ser recebidos pelo método legado apesar de
o servidor proibir a combinação), e rejeição de operação que usa UID/nome
de uma sessão anterior após troca de Auth. Um caso de recusa correta não
significa que a interface antiga mostre um erro específico ou impeça o usuário
de tentar a ação. Não são testes físicos com os APKs de produção.

Nenhuma versão mínima foi fixada. Falhas de rede, UX de atualização, proteção
de menores e moderação da Issue #200 continuam impedindo o rollout.

## Etapas ainda dependentes de autorização
1. Inventariar APKs antigos, assinaturas, canais e versionCode reais.
2. Definir versão mínima, comunicação e período de atualização.
3. Preparar APK de atualização com mesmo applicationId/certificado e
   versionCode maior; resolver o OTA obrigatório em homologação.
4. Completar a garantia de aviso para todos os destinatários e testar
   o comportamento de cliente antigo e novo no Firestore Emulator.
5. Validar segurança, compatibilidade, despesas e o bloqueador #200
   (proteção etária, moderação e retenção) com revisão apropriada.
6. Somente depois de autorização expressa: distribuir versão compatível,
   manter a flag inicialmente desligada e planejar ativação monitorada
   e reversão. Não atualizar Rules, main ou produção neste PR de estudo.

## Execução manual opcional (somente QA)
Na pasta tests/security, com Java 17 e Node 20:

    npm ci --ignore-scripts
    node prepare.mjs
    ./node_modules/.bin/firebase emulators:exec --only firestore \
      --project demo-atrio-v11 "node reply-notice-migration-lab.test.mjs"

O workflow específico não recebe credenciais produtivas, não faz
deploy, não muda backup e não modifica o APK.

## Proteção experimental contra reutilização de avisos — nova regressão

O laboratório de 20 testes não cobria este caso: Miguel pode criar uma resposta
e um aviso canônico, apagar apenas a resposta e tentar recriar outra com o
mesmo ID. O aviso original continua existente. Uma regra que aceita apenas
`existsAfter(aviso)` pode ser enganada, pois a função também retorna verdadeiro
para o aviso **antigo**, sem exigir nova notificação no lote atual.

A proposta foi reforçada, **somente na cópia de regras carregada pelo Firebase
Emulator**, para exigir `getAfter(aviso).data.createdAt == request.time`.
Isso aproveita a verificação completa do `allow create` já existente para
o aviso novo e evita aceitar timestamp de operações passadas. Um novo teste
cria resposta+aviso, apaga a resposta, tenta reutilizar o aviso e exige
rejeição sem nova resposta persistida. O resultado dessa regressão será
validado no CI específico; não está implícito nos 20 testes anteriores.

**Limite:** regras não reconhecem a intenção de uma pessoa quando o cliente
antigo alterna de conta e monta uma publicação aparentemente válida como o
novo usuário; por isso a proteção do lado do cliente na PR continua necessária.
Nenhuma versão mínima, rollout ou mudança em `firestore.rules` foi autorizada.
