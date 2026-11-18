# Guardião V2 — conferência offline das evidências autenticadas de homologação

**14/11/2026.** Continuação da PR #289. A simulação em memória e seus 21 testes seguem inalterados. Este passo acrescenta uma **checagem conservadora de relatórios sanitizados** que serão produzidos após provas externas reais em QA, sem confundi-las com testes Python locais.

## Situação e objetivo

O workflow de produção ainda utiliza a mesma identidade WIF de escrita para triagem e ativação. Nenhum teste da PR #289 validou IAM real, concorrência distribuída ou autenticação de tokens. O risco permanece **NO_GO** para implantação e migração. O propósito desta etapa é impedir que um futuro teste incompleto — por exemplo, um HTTP 401 causado por token inválido — seja apresentado como negação válida de uma identidade autenticada.

Código: `scripts/guardian_v2_qa_evidence_gate.py`. Testes: `scripts/test_guardian_v2_qa_evidence_gate.py`. É código local, sem SDK, servidor, rede, token, credenciais, Firebase, Cloudflare, deploy ou escrita em produção.

## Entrada esperada

Um JSON **local e sanitizado**, guardado fora do Git e sem dados de usuários, URLs completas, tokens, payloads, cabeçalhos, política IAM ou caminhos reais de documentos.

- Campos de topo, exatamente: `qa_project`, `qa_isolated_confirmed`, `qa_iam_reviewed`, `qa_costs_authorized`, `evidence_origin` e `cases`.
- `qa_project` deve ser o identificador real do projeto **independente e autorizado de QA**, verificado manualmente. Os identificadores `atrio-catolico` e `guardian-v2-qa-fixture` são proibidos. O campo não demonstra sozinho o isolamento.
- Três declarações booleanas exigidas: `qa_isolated_confirmed`, `qa_iam_reviewed`, `qa_costs_authorized`, todas `true` após verificação do responsável. Não é autorização criada pelo programa.
- `evidence_origin` vale exatamente `authenticated_external_qa`, nunca `offline_fixture`.
- `cases` é uma lista com **16 cenários exatos**, um de cada identificador em `SCENARIOS` do próprio código, sem duplicatas, identificadores novos ou campos extras.
- Em cada cenário, fornecer somente: `scenario` (ID da matriz), `principal` (`TRIAGE` ou `ACTIVATION`), `authenticated` (booleano), `http_status` (inteiro), `pre_post_checked` (booleano), `effects_present` (booleano) e `evidence_ref` (rótulo opaco, formato `QA-...`, **não** URL ou log bruto).

O resultado esperado é fixado pelo código para cada cenário. **ALLOW** só é candidato se autenticado, HTTP 2xx e efeito pós-verificado: leitura sem escrita; criação ou atualização com efeito esperado. **DENY** exige identidade autenticada, HTTP **403** e verificação independente da ausência de efeitos. HTTP 401, timeout, 404 e erro de rede não comprovam autorização negada, portanto permanecem `NO_GO`.

Os 16 cenários incluem leitura de política, criação sintética de caso/auditoria/aviso e orçamento permitido; negações de escrita direta de política, perfis, posts, allowlist externa, operações da identidade oposta, exclusão e impersonação WIF em ambas as direções. Uma verificação de efeito em relatório **não comprova** atomicidade por si só: avaliar transações Firestore e duplicidades entre instâncias separadamente, com evidência real.

## Como utilizar após a homologação autorizada

Pelo Termux, na branch ou checkout correspondente:

```bash
python3 -m unittest scripts.test_guardian_v2_qa_evidence_gate -v
python3 -m scripts.guardian_v2_qa_evidence_gate
# Sem relatório real retorna NO_GO e saída 2, intencional.
python3 -m scripts.guardian_v2_qa_evidence_gate /caminho/local/relatorio-qa.json
```

Quando o JSON atende **apenas** às regras de consistência e completude, o resultado é `CANDIDATO_REVISAO_HUMANA` com saída 0; **jamais GO para produção**. Sem relatório válido retorna `NO_GO` com saída 2. O programa imprime somente códigos de status agregados; não publica conteúdos de evidência.

**Revisão independente ainda obrigatória:** conferir documentos e logs privados originais, validade criptográfica/audiência/emissor dos tokens, identidade real por workflow e provider, papéis IAM efetivos e herdados, ausência de acesso direto ao Firestore, custos, concorrência, taxa, rollback e eventual impacto nos agendamentos. Uma pessoa pode escrever `authenticated: true` em JSON sem nunca ter autenticado: este validador **não prova** a afirmação.

## Limites e próximas ações

1. Preparar uma implementação de serviço mediador confiável e verificação de identidade em uma branch própria, sem deploy automático.
2. Confirmar projeto/banco QA distintos, papéis, custos e permissões com o responsável **antes** de qualquer operação Google Cloud de criação, patch ou delete.
3. Executar posteriormente as provas autenticadas de cada cenário e capturar apenas referências sanitizadas neste JSON, nunca credenciais no repositório.
4. Reavaliar arquitetura, isolamento externo, carga/concorrência e rollback antes de qualquer proposta de migração; **produção exigirá autorização separada**.

Nenhuma modificação desta PR deve alterar o workflow privilegiado, WIF, cron, IAM, banco, segredos, regras Firebase, dados reais, backups ou a branch principal. Merge somente mediante autorização expressa.
