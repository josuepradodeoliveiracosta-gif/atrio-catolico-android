# Guardião V2 — preparação de disparo QA gratuito pela Cloudflare

**Data: 29/10/2026. Status: implementado em branch de testes, execução DESATIVADA.**

## Objetivo e limites

Reutilizar o cron já configurado no Worker **`atrio-guardian-v2-qa`** para poder pedir uma execução do workflow GitHub Actions `guardiao-autonomo-qa.yml` **uma vez por dia às 03h UTC**, se e somente se isso for explicitamente autorizado. O workflow existe na feature branch e já foi disparado manualmente com sucesso no GitHub Actions; a execução é no GitHub, que obtém acesso temporário ao Firebase QA por Google WIF.

O módulo `src/github-qa-dispatch.js` envia **somente** `POST /repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/workflows/guardiao-autonomo-qa.yml/dispatches` com `{"ref":"feature/guardiao-autonomo-20261029"}`. Não aceita endereço, caminho, branch ou inputs arbitrários. A API do GitHub exige um **fine-grained personal access token** com permissão de repositório **Actions:write**, limitado ao único repositório do Átrio, com duração curta. É uma credencial de **GitHub**, NÃO uma chave Firebase, e tem privilégio de disparar outros workflows no repositório: revisão de segurança obrigatória.

O cron atual permanece `*/15 * * * *`, mas só às **03:00:00 UTC** autoriza um POST (e **nenhum** em outros horários). A proteção por horário não é um mecanismo de idempotência durável: reexecuções do evento no mesmo minuto podem duplicar o disparo. O mecanismo nunca usa Cloud Run, Cloud Scheduler ou conta de faturamento. A documentação oficial informa que *standard GitHub-hosted runners em repositórios públicos* e *Cloudflare Workers Free dentro das cotas* não exigem contratação de plano pago. GitHub pode aplicar limites e políticas de uso; não há promessa de execuções ilimitadas.

## Configuração de segurança — NÃO habilitar ainda

Os seguintes campos foram adicionados ao `wrangler.qa.toml` com **`false`**, e devem continuar assim após eventual deploy do código:

```text
GUARDIAN_V2_TEST_MODE=true
GUARDIAN_V2_ENABLED=false
GUARDIAN_V2_HOLD_ENABLED=false
GUARDIAN_V2_QA_SHADOW_READS=false
GUARDIAN_V2_QA_RUN_MONITOR=true
GUARDIAN_V2_QA_AUTO_DISPATCH=false
GUARDIAN_QA_DISPATCH_READY=false
```

O segredo opcional `GUARDIAN_QA_GITHUB_DISPATCH_TOKEN` **não deve ser criado até que o usuário autorize explicitamente**. Não colocar PAT em código, `wrangler.toml`, GitHub, chat, screenshots, logs ou APK. Após autorizar e obter um token fine-grained curto, cadastrá-lo **somente** como secret do Worker isolado QA; não reutilizar token GitHub pessoal amplo. Sem segredo ou com qualquer flag desligada, o cron **não faz POST**. O código não altera a variável GitHub `GUARDIAN_QA_REMOTE_READY`; ela deve continuar `false` por padrão.

### Por que ainda não ativar

- O workflow atual inclui testes Android e de segurança, não só a leitura remota. Dispará-lo diariamente envolve processamento desnecessário e pode esbarrar em restrições de uso.
- O job `remote-qa-readonly` exige explicitamente `GUARDIAN_QA_REMOTE_READY=true` nas variáveis do repositório. Esse valor está sujeito a controles manuais e **não deve ficar indefinidamente ligado**, pois habilita leitura sem revisão em cada execução.
- A verificação de leitura busca **somente documentos marcados `qaFixture=true` criados nos últimos 20 minutos**. As três fixtures reais ficam antigas; um disparo diário sem dados sintéticos recentes deve falhar como `qa_synthetic_fixtures_missing`. **Nunca tratar isto como moderação em tempo real ou sucesso remoto.**
- Para criar novos dados sintéticos de maneira periódica seria necessário um componente separado com IAM de escrita, sujeito a outra revisão de segurança; **não habilitar só para fazer o teste ficar verde**.
- Para evitar disparos duplicados seria necessário armazenamento/idempotência própria e políticas de execução apropriadas. O protótipo atual verifica o horário, mas não persiste o ID dos eventos.

## O que já funciona sem pagar

1. QA remoto manual GitHub WIF **já comprovado** no run `40966233058` com `clear=1,hold_candidate=1,reports=1,error=0`.
2. Cron Cloudflare QA de observação do **resultado público** do GitHub a cada hora, sem autenticação e sem Firestore (código em `github-qa-monitor.js`).
3. Testes offline e Firestore Emulator que não requerem criar recursos pagos.
4. Código opcional do disparo com falha segura e testes em `github-qa-dispatch.test.js`, ainda sem configuração de credenciais.

**Próximo passo seguro sugerido:** manter `GUARDIAN_V2_QA_AUTO_DISPATCH=false`, `GUARDIAN_QA_DISPATCH_READY=false` e a variável GitHub `GUARDIAN_QA_REMOTE_READY=false`. Construir workflow pequeno QA-only e limitar rigorosamente a periodicidade antes de pedir ao usuário um token que pode acionar workflows. Isso não requer Cloud Run, Cloud Scheduler nem billing.

Fontes: [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage), [GitHub create workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
