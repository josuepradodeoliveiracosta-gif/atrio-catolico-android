# Átrio Católico — suspensão do disparo automático da autocorreção QA

**Decisão do proprietário:** 13/11/2026.  
**Estado deste documento:** proposta técnica na PR em rascunho; só produzirá efeito automático na branch padrão após merge autorizado.  
**Objetivo prioritário:** coleta eficiente, segura e auditável de evidências sobre possíveis erros, para análise e proposta de correção pelo assistente.

## Decisão e alcance

A pedido do proprietário, suspender o disparo **automático** de `.github/workflows/autofix-qa-approved-draft.yml`, anteriormente acionado pelo término do CodeQL na `main` por meio do evento `workflow_run`. O disparo deixa de contribuir para o novo objetivo principal do sistema de diagnóstico.

A medida tem **três compromissos**:

1. **Desligar o acionamento automático da autocorreção QA.** O bloco `on.workflow_run` é substituído por um único gatilho manual `workflow_dispatch`, intencionalmente **inoperante**: ambos os jobs exigem explicitamente `github.event_name == 'workflow_run'` e suas demais condições originais. Assim, um disparo manual não deve executar preflight, escritor, emitir token da GitHub App, abrir PR ou aplicar qualquer reparo. O objetivo é arquivar com segurança até eventual decisão futura.
2. **Preservar código e histórico.** Os scripts `scripts/ci_autofix_*`, a receita estática, os testes, as condições de segurança e o histórico Git existente não são excluídos. A configuração de contas, tokens, ambiente e dados existentes não é modificada. Reativação futura exige revisão de segurança, autorização expressa e PR separada.
3. **Manter diagnóstico e coleta ativos.** `.github/workflows/ci-quality-report.yml` permanece inalterado com `workflow_run` após CodeQL e `workflow_dispatch`. Seus leitores `ci_quality_report.py`, `ci_diagnostic_snapshot.py`, `ci_log_identity_verifier.py` e `ci_log_safe_analysis.py` permanecem ativos, com saída de evidências e sem merge, deploy ou correção automática. Seus passos legados de planejamento de reparo permanecem somente informativos nesta mudança.

O fluxo separado `qa-doc-app-draft-manual.yml`, reservado a testes documentais **expressamente manuais e autenticados**, não é modificado. Esta decisão concerne exclusivamente ao **gatilho automático** do workflow QA de PR draft, não constitui remoção de toda capacidade manual de desenvolvimento/teste e não revoga autorizações em outras áreas.

## Alterações exatas desta PR

| Arquivo | Alteração |
| --- | --- |
| `.github/workflows/autofix-qa-approved-draft.yml` | Substitui somente o gatilho automático por disparo manual inerte; mantém jobs e guardas e adiciona condição de evento aos dois jobs |
| `scripts/test_ci_autofix_automatic_gate.py` | Atualiza teste estrutural para exigir ausência de gatilhos automáticos e garantir inércia da execução manual; acrescenta verificação de preservação do workflow de coleta |
| Este documento | Registra decisão, limites, validação e reversibilidade |

O código de autocorreção continua versionado e acessível, mas **não deve ser interpretado como autorizado a executar** por causa desta PR. Não modificar `ci-quality-report.yml`, `selos-ci.yml`, Firestore Rules, Cloudflare, Firebase, assinaturas ou backups.

## Critérios objetivos de aceitação

- A definição do workflow de autocorreção contém **exatamente `workflow_dispatch`** como evento; sem `push`, `pull_request`, `workflow_run`, `schedule` ou `pull_request_target` em `on`.
- Os jobs `preflight` e `write_draft` permanecem preservados, mas cada um exige evento `workflow_run`; como esse evento não é mais inscrito em `on`, **não há caminho de execução autorizado** pelo workflow nessa configuração.
- Nenhum token novo, alteração de permissões ou acesso a dados reais é concedido; o job escritor preserva seus controles históricos e não é ativado pelo disparo manual.
- Testes offline existentes continuam cobrindo as condições antigas como **contrato histórico de segurança para eventual reativação** e novos testes garantem ausência do disparo automático e presença dos gatilhos de diagnóstico.
- `.github/workflows/ci-quality-report.yml` mantém seus gatilhos automáticos de coleta e as permissões de leitura; os artefatos `ci-report.json`, `ci-diagnostics.json`, `ci-job-evidence.json` e `ci-log-signals.json` continuam configurados.
- Validar os checks obrigatórios **do commit efetivamente publicado** e comparar diff com a `main`; uma aprovação anterior não comprova o HEAD atual.
- PR em rascunho, **sem merge** até autorização explícita.

## Limites de conclusão e cronologia

**Antes do merge:** esta mudança existe **somente na branch da PR**. O arquivo presente na `main` continua com o gatilho automático anterior; portanto **não é correto afirmar que a automação foi desativada na produção do GitHub Actions**. Caso o objetivo seja interromper imediatamente o disparo no repositório principal, será preciso integrar a PR mediante autorização expressa ou fazer alteração administrativa separada, sujeita às mesmas proteções.

**Depois de um merge autorizado e checks bem-sucedidos:** conferir o workflow na `main`, seus eventos e a execução do relatório de diagnóstico após CodeQL, além de verificar a ausência de novos runs automáticos da autocorreção relacionados ao evento. A ausência de runs por pouco tempo, isoladamente, não comprova a suspensão.

O plano geral do diagnóstico segue na nova diretriz e auditoria da [PR #278](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/278): etapa 1 (documentação) e etapa 2 (auditoria) concluídas, etapas 3–5 pendentes. Esta suspensão é **ajuste de operação e prioridades**, não comprovação de implementação/homologação do coletor completo.

**Segurança:** nenhum push direto ou merge na `main`, mudança de backup, deploy, alteração em Firebase/Cloudflare ou dados reais autorizados por esta entrega.
