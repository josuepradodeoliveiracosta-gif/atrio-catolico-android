# Guardião V2 — pré-voo de separação de privilégios (somente leitura)

**14/11/2026.** Este documento não autoriza mudanças no IAM, no Firebase, em produção ou na branch `main`. A proteção `main` do ambiente GitHub foi comprovada e a PR #286 passou a fixar as actions por SHA; esses controles **não substituem** uma fronteira real de privilégio de escrita.

## Situação comprovada pelo código

No workflow `.github/workflows/guardiao-v2-moderator-runner.yml`, os jobs `moderator` (agendado) e `activate-policy` (manual) usam:
- a **mesma service account** `guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com`;
- o **mesmo pool/provider WIF** `guardian-v2-writer/github-moderator`;
- o **mesmo environment** `guardian-v2-production-moderation`.

A conta recebe no contrato de provisionamento um papel no **escopo do projeto** contendo `datastore.entities.create` e `datastore.entities.update`. Assim, a separação de funções `if` no workflow e a validação dos caminhos no JavaScript não constituem uma proibição IAM independente contra o uso indevido de um token da conta de escrita. O auditor do Google Cloud confirmou conformidade com o contrato atual, não isolamento por coleção.

## Avaliação offline reproduzível

```bash
python3 -m scripts.guardian_v2_isolation_preflight
```

A ferramenta examina só os **dois jobs e os três campos de identidade** citados, com um parser propositalmente limitado, e imprime apenas estados, nunca identidades, caminhos de documentos, credenciais ou políticas completas. Não usa rede nem Firebase. A saída atual deve indicar **`COMPARTILHADO` nos três campos e `decisao: NO_GO`**, com exit code 2. Esse código de saída é intencional: não significa que o CI esteja com falha, mas que a **migração não está pronta para produção**. A suíte offline de 10 testes comprova que mudar apenas a conta, apenas o provider ou apenas o ambiente continua sendo `NO_GO`.

Mesmo que três nomes diferentes apareçam futuramente, o resultado máximo do scanner será `EXIGE_PROVA_QA_IAM`. Ele **nunca** autoriza produção: nomes diferentes no YAML não demonstram papéis efetivos, vínculos de impersonação, políticas herdadas, restrições Firestore nem autenticação realmente implantada.

## Plano de migração que exige autorização própria

1. Preparar **um workflow manual de ativação**, com environment exclusivo e controle de aprovação compatível com a política operacional; manter a triagem agendada no workflow atual para não afetar cron. O novo workflow deve ter `workflow_ref` WIF próprio e condição de identidade inequívoca.
2. Em **homologação**, provisionar provider e service account exclusivos de ativação. Não reutilizar o principal da triagem. A migração deve impedir que um token de triagem assuma a identidade de ativação e vice-versa.
3. Restringir **externamente** os caminhos/ações de escrita da identidade de triagem, com um mediador confiável ou uma fronteira de banco/projeto devidamente estudada. Simplesmente criar outra service account com `datastore.entities.update` no mesmo banco e projeto **não prova limitação por coleção**.
4. Executar provas negativas autenticadas em QA: a identidade de triagem **não pode** atualizar `guardian_config/policy` ou outros documentos fora de escopo mesmo se o script for adulterado; a identidade manual só pode exercer as alterações de política aprovadas, sob controles independentes.
5. Registrar custos, segurança, rollback, observabilidade e impacto nos agendamentos. Só então decidir sobre troca de identidades, remoção das antigas concessões e eventual produção, com **autorização separada**.

**Fora de escopo desta PR:** deploy, novos serviços, mudanças de IAM, Cloudflare, Firestore, ambiente GitHub, secrets, banco de dados, cron e integração na `main`. O objetivo é tornar o risco e os critérios de saída observáveis por testes de regressão sem declarar proteção inexistente.
