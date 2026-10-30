# Guardião V2 — automação gratuita de QA por Cloudflare Cron

**Status atualizado: o Worker de testes `atrio-guardian-v2-qa` foi implantado em 30/10/2026 UTC com o heartbeat sintético.** A `main`, Firebase oficial, backups, Worker Push e APK Release seguem intocados. O aplicativo ainda não foi publicado e não tem usuários reais. Firebase oficial `atrio-catolico`, `main`, backups, Worker `atrio-push` e APK Releases não foram alterados.

## O que pode funcionar autonomamente sem credenciais

O Worker **isolado de QA** `atrio-guardian-v2-qa`, atualizado com a versão desta PR, continua recebendo seu Cron gratuito `*/15 * * * *`. Uma nova chave no `wrangler.qa.toml` (`GUARDIAN_V2_QA_POLICY_HEARTBEAT=true`) permite rodar um teste autocontido de **cinco exemplos sintéticos e fixos** de moderação:

- discussão católica legítima → `clear`;
- link solicitando senha → revisão por possível phishing;
- ameaça explícita → revisão;
- citação religiosa que menciona ameaça → `clear`;
- quatro links repetidos → advertência.

A resposta é limitada a `{status:"passed",checks:5}` ou `{status:"failed",checks:n}`. Nenhum texto original, UID, token, senha ou documento é escrito/registrado. Não há chamadas ao Firebase nem ação de moderar usuários. Verificações rígidas garantem flags QA: `GUARDIAN_V2_TEST_MODE=true`, `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false`, `GUARDIAN_V2_QA_SHADOW_READS=false`, nenhuma credencial Firebase.

O cron apenas registra uma linha `guardian_v2_qa_policy_heartbeat` nos logs do próprio Worker, que ainda deve ser confirmada **nos logs do Worker QA após o primeiro disparo agendado**. A implantação e as flags foram verificadas, mas isso não equivale a um log de execução já observado. Isso não é monitoramento de conteúdo e não prova disponibilidade 24 horas do backend real.

## Por que o GitHub Actions ainda não consegue ser acionado pelo Cron

O workflow `.github/workflows/guardiao-autonomo-qa.yml` está **somente na feature branch**. A verificação do repositório em 29/10/2026 confirmou que ele **não existe na branch padrão `main`**. Segundo a [documentação GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch), `workflow_dispatch` somente recebe eventos quando seu arquivo está na branch padrão.

O módulo anterior `github-qa-dispatch.js` permanece desativado por `GUARDIAN_V2_QA_AUTO_DISPATCH=false` e `GUARDIAN_QA_DISPATCH_READY=false`; não criar PAT por enquanto, pois um token não remove essa restrição. Qualquer futura decisão de acrescentar um workflow mínimo na `main` exigirá **autorização explícita** e revisão de segurança. Não existe alternativa gratuita **já ativa** que faça o Worker atual autenticar no Firebase e aplicar moderação contínua sem credenciais.

## Garantias de custos

A Cloudflare publica [limites do plano Workers Free](https://developers.cloudflare.com/workers/platform/limits/): cada execução do Cron Free tem um orçamento de 10 ms de CPU, portanto o heartbeat tem apenas cinco classificações leves, nenhum processamento de dados reais e não pede funções de armazenamento ou serviços pagos. Não habilitar Workers Paid, Cloud Run, Cloud Scheduler ou faturamento Google.

## Validação do código antes de um deploy QA

- `src/qa-policy-heartbeat.test.js`: verifica cinco exemplos, detecção de regressão, não vazamento e bloqueios QA;
- `src/qa-cron.test.js`: testa `scheduled()` sem acesso externo ou gravação;
- `npm test` em `cloudflare/guardian-worker` roda esses testes no CI;
- `wrangler.qa.toml` continua bloqueando todo acesso privilegiado ao Firestore.

**Implantação verificada via Cloudflare API:** atualização de 8 módulos na identidade de conta existente, versão implantada `33d1e06e-c5c7-4868-beaf-6de9fbc7f59b`; o cron `*/15 * * * *` permaneceu, `GUARDIAN_V2_QA_POLICY_HEARTBEAT=true`, `GUARDIAN_V2_TEST_MODE=true`, `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false`, `GUARDIAN_V2_QA_SHADOW_READS=false`, `GUARDIAN_V2_QA_AUTO_DISPATCH=false`, `GUARDIAN_QA_DISPATCH_READY=false`, **zero secrets**. O GitHub CI do HEAD antes deste ajuste de documentação aprovou 7/7 jobs efetivos, com 121/121 testes do motor e 12/12 QA adicionais.

**Próximo passo técnico:** confirmar uma execução de `guardian_v2_qa_policy_heartbeat` nos logs Cloudflare e avançar numa arquitetura de autenticação mínima que permita um backend de moderação real 24/7 sem faturamento. Nenhuma moderação real será ativada nessa fase.
