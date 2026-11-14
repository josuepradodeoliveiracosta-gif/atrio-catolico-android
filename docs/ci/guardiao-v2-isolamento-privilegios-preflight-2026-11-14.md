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


## Matriz de negações para homologação (não executada)

Esta matriz é **um plano de testes futuros**, não uma alegação de que o ambiente QA já existe, de que os acessos foram negados ou de que alguma mudança IAM foi aplicada. Pré-condição obrigatória: projeto e banco **exclusivos de homologação**, confirmados pelo proprietário e diferentes de \`atrio-catolico\`, com apenas documentos e atores sintéticos. Não executar operações reais de criação, PATCH ou DELETE enquanto essa homologação e seu custo não forem autorizados.

| Identidade QA | Operação representativa | Resultado exigido | Fronteira que precisa impor o resultado |
|---|---|---|---|
| Triagem agendada | Ler \`guardian_config/policy\` | ALLOW | Leitura necessária para parada emergencial |
| Triagem agendada | Criar casos, auditoria e avisos sintéticos válidos | ALLOW | Mediador autenticado ou isolamento de dados |
| Triagem agendada | Atualizar orçamento sintético com CAS | ALLOW | Mediador autenticado ou isolamento de dados |
| Triagem agendada | Fazer PATCH direto em \`guardian_config/policy\` | **DENY**, sem efeito | IAM/arquitetura, não apenas validação JavaScript |
| Triagem agendada | Alterar perfis, posts ou replies, mesmo adulterando o script | **DENY**, sem efeito | Fronteira externa independente do processo |
| Triagem agendada | Criar/alterar documentos em coleção fora da allowlist | **DENY**, sem efeito | Fronteira externa independente do processo |
| Ativação manual | Atualizar somente os dois campos de política permitidos, com aprovação e versão CAS | ALLOW condicionado | Serviço mediador + autorização de operação |
| Ativação manual | Criar caso, aviso, auditoria ou modificar orçamento | **DENY**, sem efeito | Privilégio distinto e rota limitada |
| Ambas | Apagar qualquer documento | **DENY**, sem efeito | Autorização externa |
| Ambas | Obter credencial da outra identidade por impersonação WIF | **DENY** | Políticas e bindings WIF independentes |

As negações precisam ser testadas **por solicitações adversariais feitas com a identidade autenticada de QA**, inclusive solicitações que contornem o JavaScript original. Não aceitar como prova apenas um teste unitário que recuse uma função local.

**Evidência mínima por caso:** ID abstrato do cenário acima (não ID de documento/usuário), identidade sintética rotulada apenas TRIAGEM ou ATIVAÇÃO, estado esperado, resultado ALLOW/DENY, confirmação de ausência de efeitos colaterais, timestamp e referência a um log de QA com acesso restrito. Não registrar conteúdo de usuários, tokens, credenciais, URLs completas dos documentos ou payload de IAM em CI público. Resultado ausente, 401 de autenticação inválida, timeout ou erro de rede devem ser **INCONCLUSIVO**, nunca uma prova de DENY de autorização.

A ferramenta **Policy Troubleshooter** do Google Cloud pode auxiliar em consulta somente de leitura para principal/permissão/recurso, respeitando acesso às políticas herdadas, mas **não comprova autorização por coleção/campo** no Firestore. Condições IAM por banco não se confundem com isolamento de coleção dentro do banco \`(default)\`. Fontes técnicas oficiais: https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access e https://docs.cloud.google.com/firestore/native/docs/manage-databases.

**Critério para passar do NO_GO à revisão humana:** todos os cenários obrigatórios executados em QA autorizado, resultados negativos genuínos e positivos previstos, evidências sem vazamentos, avaliação de custos/latência/falha e plano de rollback documentado. Mesmo assim, qualquer deploy ou mudança IAM/Firebase de produção exigirá uma nova autorização expressa. Nenhum passo deste documento aprova uma operação de produção.
