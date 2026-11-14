# Guardião V2 — contrato do mediador QA e fronteira externa (somente planejamento)

**14/11/2026.** Este documento e o simulador associado não implantam serviços, não provisionam identidades, não alteram Firestore/IAM e não autorizam produção. A triagem agendada permanece como está na main.

## Risco que a separação deve eliminar

Atualmente, os jobs `moderator` e `activate-policy` usam o mesmo provedor WIF e a mesma conta `guardian-v2-writer`, cuja função Firestore inclui permissões de criação e atualização no escopo do projeto. Um token da triagem pode ser utilizado fora do código normal para tentar atualizar `guardian_config/policy`. Um guard JavaScript no mesmo executor **não é fronteira externa**. Separar nomes de service accounts sem revogar o acesso direto ao mesmo Firestore tampouco resolve.

## Arquitetura candidata — NÃO implantada

1. **Chamadores distintos**: job agendado de triagem e workflow **manual** de ativação com `workflow_ref` e environments diferentes, provedores WIF restritos ao repositório/branch/workflow/environment corretos e identidades com o mínimo necessário para chamar um serviço. São necessárias condições de atributos e bindings distintos. A ativação nunca deve herdar permissão de triagem.
2. **Mediador autenticado privado em QA**: serviço isolado (Cloud Run é uma opção, não uma decisão de contratação) que valida token de **ID** com audiência correta, assinatura, emissor e principal do chamador. A autorização `roles/run.invoker` é configurada por serviço, mas uma única permissão de invocação não diferencia operações: o mediador também deve mapear uma identidade autenticada a uma rota e negar a outra. **Nunca** aceitar `role`, `email` ou `workflow` declarados pelo corpo HTTP como prova.
3. **Identidade de banco exclusiva do mediador**: nenhum job GitHub pode manter `datastore.entities.create/update` no Firestore de destino nem impersonar a conta do mediador. Só o mediador terá o privilégio de banco necessário. O aplicativo do mediador precisa impor a allowlist de operações e documentos, política de parada, limites de casos, `source.updateTime` e CAS. Uma falha do mediador ainda é risco relevante porque sua conta pode ter ampla permissão IAM; avaliar isolamento por banco/projeto, observabilidade, quotas e custos antes do deploy.
4. **Intenções, não comandos Firestore genéricos**: o cliente de triagem só solicita leitura de política ou propõe um caso com identificadores sintéticos validados. O mediador gera transações de caso, auditoria, aviso e orçamento, com verificação de origem e política. O cliente manual solicita *somente* habilitação não punitiva, sob aprovação humana e versão CAS; o mediador define exatamente `enabled` e `autonomousWriteEnabled`. Não oferecer endpoints `:commit`, PATCH livre, delete, alteração de usuários/posts ou de `emergencyStop`.
5. **Transição segura**: primeiro testes adversariais autenticados em projeto/banco QA dedicados e autorização do custo/recursos; depois plano de cutover e rollback; só após autorização separada revogar IAM direto do writer de produção e migrar workflow. Não alterar a conta de produção nem desativar cron por esta PR.

Referências oficiais: [Firestore IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam), [autenticação serviço a serviço no Cloud Run](https://docs.cloud.google.com/run/docs/authenticating/service-to-service) e [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation).

## Protótipo offline: o que demonstra e o que NÃO demonstra

`scripts/guardian_v2_qa_mediator_contract.py` contém `simulate_qa_intent` sobre um **identificador de projeto fictício** (`guardian-v2-qa-fixture`). Recebe papel fornecido pelo próprio teste, **não** autentica tokens nem integra uma API. Retorna `SIMULATED_ALLOW` ou `SIMULATED_DENY` com `production_authorized: false`, nunca ALLOW/DENY do IAM real. Um êxito de simulação **não prova contenção externa** nem existência desse projeto.

A suíte `scripts/test_guardian_v2_qa_mediator_contract.py` cobre 14 grupos de cenários offline: leitura permitida, proposta de caso e reply sintéticos, ativação manual condicionada, negação cruzada de papéis, operações diretas Firestore e exclusões proibidas, negação no projeto de produção, identidade falsificada no payload, caminhos inválidos, ausência de aprovação, versões desatualizadas, parada emergencial e tipos malformados. É acionada no workflow de segurança já existente, sem novo workflow, secrets ou identidade.

**Critério de aceite desta PR**: os 14 testes e os checks regulares do GitHub passam no HEAD exato; o diff contém somente simulador, testes, documentação e uma linha de CI; `main` permanece inalterada até autorização expressa para merge.

**Critério para etapa 3/7 ser concluída** (fora desta PR): evidência de autenticação e negações reais no QA, incluindo tokens válidos sem permissão de banco direto; aprovação de custos e plano de rollback; validação de caminho direto negado mesmo adulterando o script, e adoção controlada em produção somente após autorização específica. A matriz detalhada está em `docs/ci/guardiao-v2-isolamento-privilegios-preflight-2026-11-14.md`.
