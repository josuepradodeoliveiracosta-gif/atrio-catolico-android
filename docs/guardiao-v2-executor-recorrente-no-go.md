# Guardião V2 — preparação do executor recorrente sem chave permanente

**Estado em 31/10/2026: NO-GO para produção.** Este documento apresenta a etapa seguinte às PRs #50 (auditoria de testes), #51 (três integrações no Firestore Emulator) e #52 (três testes de interface Android V2). Nenhum código desta PR cria um cron ou concede acesso ao Firebase.

## Decisão de arquitetura em preparação

- Motor de moderação V2 executado **fora do APK**, com identidade temporária por execução. GitHub Actions com OIDC → Google WIF é uma possibilidade, mas não equivale a execução instantânea nem a serviço 24 horas de baixa latência.
- O cron do Cloudflare não recebe identidade OIDC do GitHub; não pode reaproveitar implicitamente o token temporário da prova QA.
- A leitura WIF manual anterior, no run **41156806802, tentativa 2**, provou apenas autenticação e GET 200 de uma fixture do projeto `atrio-catolico-qa-v2`. Não repetir a mesma prova. Ela não autoriza o Firestore de produção, não comprova IAM mínimo por coleção e não demonstra execução periódica.
- Um workflow `schedule` do GitHub executa na branch padrão (`main`). O provedor WIF anterior foi aprovado para branches QA, portanto um executor na `main` exigirá revisão e autorização separada da condição IAM/WIF, com restrição à **identidade, workflow e ambiente exatos**. Não modificar IAM nesta etapa.

## Implementação efetiva desta PR (sem conexão externa)

1. `scripts/guardian_v2_executor_preflight.mjs` avalia um contrato *offline* de contexto exato: repositório, evento **manual**, `main`, referência do workflow, flags de segurança, ausência de credenciais e ausência de ativação de QA remoto. Retorna sempre **`NO_GO_PRODUCTION`**, mesmo quando o pré-voo offline passa.
2. Um envelope ilustrativo de **1 execução/hora × 8 leituras/documentos por execução = 192 leituras de documentos/dia** demonstra apenas um limite **teórico**, sem consultas, sem escritas, sem reservas em banco e sem alegação de R$ 0 garantido. Proíbe alterar os parâmetros para mais que 8 leituras por rodada ou agendar com intervalo menor que 30 minutos.
3. `tests/guardian-v2-executor-preflight.test.mjs` verifica, em cenários inéditos, origem, branch, workflow, flags, credenciais, limite, negação de cron e impossibilidade de inferir GO de produção.
4. O workflow `guardiao-v2-executor-preflight.yml` contém somente `pull_request` com escopo de arquivos e `workflow_dispatch`; **não** solicita `id-token`, não tem `schedule`, segredos, OAuth, Firestore, Firebase Emulator, deploy, `wrangler` ou alterações de produção.

## Restrições reais de custo (não confundir com projeção)

No Firestore Standard, a quota gratuita publicada é de até **50 mil leituras de documentos/dia e 20 mil escritas/dia**, dentre outros limites; as quotas se aplicam ao **projeto/banco como um todo**, incluindo usuários, listeners, queries e leituras de entradas de índice quando cabível. A quota de leitura não constitui orçamento reservado por este serviço. O total de 192 é apenas cálculo de cenário, não impedimento efetivo para outros processos, e o preço também depende do plano e das configurações do projeto. **Não afirmar custo zero sem validação real do plano, demais consumos e mecanismo de parada.**

Antes de adicionar uma operação remota ao executor, é preciso um mecanismo **persistente e transacional** que reserve orçamento cumulativo diário antes de cada operação; não basta contar em RAM, pois jobs reiniciam, podem sobrepor-se e sofrer retries. O mecanismo deve considerar operações Firestore e leitura de índices e trabalhar bem abaixo das quotas aplicáveis, com parada fechada.

## Gates que faltam antes de qualquer produção

| Condição | Estado |
| --- | --- |
| PRs relacionadas revisadas e autorizadas para integração | Pendente |
| WIF/OIDC vinculado ao repositório, `main`, workflow exato e ambiente autorizado, sem chaves JSON | **Não comprovado** para executor recorrente |
| IAM realmente mínimo com revisão de escopo (o servidor não usa Security Rules do APK) | **Não comprovado** |
| Reserva diária persistente e atômica com fail-closed para jobs sobrepostos | **Não implementada** |
| Execução limitada de scanner → caso → auditoria → aviso, com identidade de servidor autorizada e dados **somente sintéticos** em QA | Pendente |
| Revogação, rollback, logs sanitizados e parada emergencial em execução agendada | Pendente |
| Autorização específica de deploy, alterações IAM, cron e eventual moderação autônoma punitiva | **Não concedida** |

## Política de não repetição dos testes

- Reaproveitar 155/155 testes Node do motor V2 da PR #50, os 15 cenários Firestore, os três E2E da PR #51 e os três testes Android instrumentados da PR #52.
- O novo workflow executa **apenas** o pré-voo inédito. Checks gerais disparados automaticamente pela configuração existente do repositório não são considerados novos testes do executor.
- Um commit de documentação não cria necessidade de repetir todos os emuladores e provas WIF. Anotar SHA e execução correspondente antes de decidir rodar novamente qualquer prova.

**Não modificar a `main`, backup protegido, Firebase real, Worker `atrio-push`, IAM, GitHub environment `guardian-qa`, cron, faturamento ou APK oficial.**

### Referências
- Google WIF: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- GitHub schedule: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Firestore quotas: https://firebase.google.com/docs/firestore/quotas
