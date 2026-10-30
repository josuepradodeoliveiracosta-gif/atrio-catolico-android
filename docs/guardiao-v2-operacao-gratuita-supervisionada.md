# Átrio Guardião V2 — modo gratuito supervisionado (etapa 5)

**30/10/2026 · Somente branch QA · produção continua NO-GO.**

## Decisão técnica

A moderação no modo gratuito é **preventiva no aplicativo + humana sob Firebase Auth e Firestore Security Rules**. Não exige executar código privilegiado no servidor, vincular conta de faturamento, distribuir JSON de service account ou operar um bot que se passe por usuário.

Fluxo disponível no desenho atual:

1. O Android executa o aviso local \`GuardianPreflight\` antes de publicar; é educativo e **pode ser ignorado por um cliente adulterado**.
2. Usuários autenticados registram denúncias com ID determinístico. Firestore Rules impedem registros por outra pessoa ou duplicatas na mesma combinação denunciante/alvo.
3. Um administrador **ativo** usa a fila de denúncias existente em \`ModerationScreen.kt\`. Para concluir, o app usa transação Firestore do próprio administrador, sem Worker privilegiado: encerrar a denúncia ou remover o alvo **e** registrar a decisão no mesmo commit. A análise é humana, sujeita a falhas de contexto; não equivale a um scanner.
4. Firestore Rules revalidam o cargo e a transação; um membro comum não pode ler denúncias nem registrar decisões. Um administrador revogado perde o acesso de cliente. Falhas na transação devem deixar o alvo e a denúncia inalterados.
5. Enquanto \`GUARDIAN_V2_ENABLED=false\`, \`HOLD_ENABLED=false\` e \`emergencyStop=true\`, o Guardião V2 **não gera casos, auditorias nem quarentenas automaticamente**. A funcionalidade humana pré-existente não necessita desse Worker e pode coexistir com a configuração desativada.

### Prova por emulador isolado

\`tests/security/guardian-v2-free-mode-emulator.mjs\` valida publicação, denúncia, privacidade, não-duplicação, remoção humana atômica de resposta, arquivamento de denúncia legítima sem exclusão, recusa de falsificação de cargo e revogação de administrador. No job \`firestore-guardiao\`, o comando \`npm run test:guardian-rules\` executa tanto a suíte de permissões do V2 quanto a suíte gratuita com banco exclusivamente emulado. Não envia conteúdo a Firebase oficial.

O script \`cloudflare/guardian-worker/scripts/check-zero-cost-qa.py\` exige configuração QA fechada, sem segredos de Firebase, sem outro Worker ou banco, com dois limitadores e apenas D1 QA. Testes de mutação verificam que mudanças inseguras falham. **Esse teste é de configuração do repositório, não atestado de plano de cobrança ativo na Cloudflare.**

## Por que não há autonomia plena 24 horas por dia

- No projeto, \`posts\` e \`replies\` requerem usuário autenticado para leitura; \`reports\` só admite administradores ativos. Um Cron Cloudflare sem identidade legítima **não tem permissão** para ler todo esse conteúdo. Abrir essas coleções ao público para contornar o bloqueio seria uma regressão de privacidade **proibida**.
- Firestore REST com **Firebase ID token** obedece às Security Rules e identidade do usuário; um token não equivale a identidade de serviço. O token da CI GitHub não concede autorização persistente ao Worker.
- Firestore REST com **OAuth de conta de serviço** opera sob IAM, contorna Security Rules de clientes e requer identidade confiável. Uma chave JSON estática está vetada no caminho de produção, e Cloud Run / Scheduler exigiriam ativar faturamento, o que foi proibido.
- O Cron Free pode executar classificações **sintéticas** sem acessar usuários; isso não torna a moderação de conteúdo real automática. Limites gratuitos não garantem disponibilidade contínua.

## Critérios ainda pendentes para operação oficial

- Confirmar em cada conta o plano Spark / Workers Free e as cotas utilizadas, sem cartão, assinatura ou upgrade.
- Validar a UX completa de denúncias e recursos no Android Debug com perfis sintéticos, inclusive desligamento e revogação.
- Decidir se o lançamento inicial será **somente prevenção local + moderação humana**, sem anunciar varredura automática 24/7.
- Para autonomia futura: projetar, auditar e testar mecanismo de acesso ao Firestore sem chave permanente nem credencial de usuário compartilhada, e garantir custo zero **sem billing**, antes de permitir qualquer leitura automatizada real. Se não for possível, a funcionalidade continua desligada.
- Revisar PR #44, aprovar mudanças e rollback antes de alterar \`main\`, Firebase oficial ou APK Release.

Fontes oficiais conferidas:
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/firestore/use-rest-api
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

**Regra financeira:** custo obrigatório igual a R$ 0. Free tier que exige faturamento não é permitido.
