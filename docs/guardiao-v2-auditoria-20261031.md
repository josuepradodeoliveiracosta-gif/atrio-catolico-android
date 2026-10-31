# Átrio Guardião Autônomo V2 — auditoria de segurança e bloqueios de implantação

Data da revisão: 31/10/2026. Fonte: main `c9123914358909085d0d40d0520537881491fac3`, PR #47 `982990f94eefbac4c959e3bf64c4662b04dffc94`, PR #48 `a3d42d8d8771d30ad2f844057f79af1660331d3c`. Esta auditoria é estática + testes offline/QA de escopo limitado, **não equivale a certificação integral da produção**.

## Resultado e prioridade

| Criticidade | Achado | Evidência e remediação |
| --- | --- | --- |
| BLOQUEADOR | Identidade contínua Cloudflare → Firebase inexistente | WIF positivo somente no job GitHub Actions #124407888885; Cloudflare Cron não herda GitHub OIDC, e chave JSON permanente está proibida pelo código. Não ativar `GUARDIAN_V2_ENABLED` nem realizar deploy. |
| ALTA | `settingsOf` aceitava apenas `ENABLED` e configuração Firestore para ligar scanner; `HOLD_ENABLED` podia autorizar retenção sem aprovação independente | **Corrigido nesta branch**: exigir `GUARDIAN_V2_PRODUCTION_APPROVED=true`, `GUARDIAN_V2_IDENTITY_APPROVED=true` e, para retenção, `GUARDIAN_V2_HOLD_APPROVED=true`, além de `GUARDIAN_V2_HOLD_ENABLED=true` e configuração em Firestore. Todos estes flags permanecem desligados na implantação atual. |
| ALTA | A conta OAuth de servidor ignora as Security Rules do app | A prova WIF autentica uma leitura fictícia, mas **não demonstra** isolamento IAM por coleção. Auditar IAM e alternativas de privilégio mínimo antes de qualquer acesso a dados reais. `roles/datastore.user` não é proteção por coleção. |
| ALTA | WIF atual confia nas duas branches QA exatas, mas não está demonstrado vínculo ao workflow específico | Antes de autorizar `main`, propor condição que também restrinja `assertion.workflow_ref` e o ambiente esperado; validar claim via documentação e operador Cloud Shell. **Não editar WIF/IAM nesta PR.** |
| ALTA | Código Firestore V2 e telas Android integrados ao repositório, mas regras oficiais e APK Release não publicados | Desenhar implantação coordenada de regras, versão Android, rollback e monitoramento. Não distribuir APK como prova de acesso sem regras implantadas. |
| ALTA | Fluxo real de cases → audit → notices → recursos, com escrita atômica, ainda não homologado ponta-a-ponta com identidade de servidor mínima | Validar primeiro no Firestore Emulator; depois QA de servidor com autorização específica, somente casos sintéticos e sem punição real. |
| MÉDIA | `schedule` do GitHub executa em `main` e pode sofrer atrasos/desativações por inatividade | Avaliar job periódico efêmero OIDC + WIF com autorização restrita ao workflow exato, ou outro executor sem chave que satisfaça preço e SLA. **Não assumir tempo real nem 24h garantidas.** |
| MÉDIA | Leitura contínua/consulta Firestore consome cotas, independentemente de o runner ser gratuito | Confirmar Spark, um banco gratuito e quota/monitoramento. Firestore tem limite gratuito de 50 mil leituras/dia e recursos pagos (PITR, TTL, backup etc.); evitar habilitar billing. Meta R$ 0 exige garantir que limites reais não sejam ultrapassados. |
| MÉDIA | Avisos privados e painel administrativos usam listeners e autenticação; ainda faltam provas E2E da UI com a nova origem real de eventos | Verificar isolamento, logout/revogação e duas contas com casos sintéticos sem conteúdo real. Não repetir nove suítes inalteradas. |
| BAIXA | Expressão de citação `ameaça recebida` não combinava após remoção de acentos | **Corrigido nesta branch** para `ameaca recebida`; evita falso encaminhamento de um relato. |

## Controles já presentes e aproveitados

- `main`: motor de classificação, paginação com checkpoint, transações condicionais, revisões humanas, recursos e acesso privado à interface; Firestore Emulator validou 15 cenários V2 e Android compilou.
- PR #47: autenticação GitHub WIF temporária (300 s), GET sintético HTTP 200 no job #124407888885, sem chave de serviço JSON, sem prova de runner 24h.
- PR #48: cinco novos testes offline em ciclo de leitura QA; sem ligação ao Worker/Android/cron.
- Worker `atrio-guardian-v2-qa` foi consultado em 31/10/2026: `TEST_MODE=true`; `V2_ENABLED`, `HOLD_ENABLED`, `QA_FIRESTORE_BRIDGE`, `QA_SHADOW_READS`, `QA_AUTO_DISPATCH` são `false`. Não foi efetuada mutação do Worker.

## Sequência acelerada sem sobreposição

1. Revisar esta PR de correções de segurança contra `main` (com CI de núcleo por mudança efetiva) e revisar PRs #47/#48; **nenhum merge sem autorização**.
2. Executar o ciclo QA keyless em uma branch que já tenha WIF e ambiente autorizados **apenas após aprovação**, sem liberar nova branch ou repetir a mesma prova WIF.
3. Provar análise + persistência sintética de casos/avisos e revisão humana em Firestore Emulator, depois QA limitado, orçamento e IAM mínimo. Separar o fluxo `hold`: não ativar punições.
4. Escolher executor recorrente sem chave: proposta GitHub Actions na `main` exigiria mudança de IAM especificada previamente, revisão da origem OIDC, quotas e autorização separada. Um cron de GitHub não significa moderação instantânea.
5. Só após GO técnico e autorização específica: merge(s), deploy de regras Firebase oficial, integração backend, rollout somente revisão humana, testes de revogação e monitoramento. APK Release e publicação são etapas distintas.

**Política invariável:** sem faturamento adicional, conta de serviço JSON, alterações na produção Firebase `atrio-catolico`, backup, `atrio-push`, publicação ou moderação punitiva autônoma nesta auditoria.

Referências:
- Google WIF: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- GitHub schedule: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Firestore quotas: https://firebase.google.com/docs/firestore/quotas
