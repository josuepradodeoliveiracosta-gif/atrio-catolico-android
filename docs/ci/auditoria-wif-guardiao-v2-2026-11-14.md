# Auditoria de segurança WIF do Guardião V2 — somente leitura e testes offline

**14/11/2026 — America/Fortaleza**. Base: `15424b743d83ed47e1d7ee0c3ccd424eebce9cac` (`main` após PR #283).  
**Escopo:** leitura de GitHub Actions, scripts, provisionamento WIF e logs existentes. *Nenhum* acesso novo a Firestore, Google IAM, OIDC real, Cloudflare ou dados de usuários; nenhum disparo remoto, deploy, alteração de variável, cron, política, branch principal, backup ou produção.

## 1. Resultado confirmado nos arquivos do repositório

**Controle de origem:** `scripts/guardian-v2-provision-wif.sh` prepara pool/provedor distintos para a conta de escrita, e exige `assertion.repository_id` 1432799501 e `assertion.repository_owner_id` 347622360, além de `assertion.ref=='refs/heads/main'`, `assertion.workflow_ref` do workflow exato e `assertion.environment=='guardian-v2-production-moderation'`. IDs conferidos com a API do repositório. O script exige `--apply` e, ao encontrar condição WIF ou papel preexistente divergente, **aborta**. O repositório não comprova a configuração **efetivamente implantada** no Google Cloud.

**Identidades separadas:** o workflow `guardiao-v2-prod-runner.yml` (observador) usa `guardian-v2-runner@atrio-catolico.iam.gserviceaccount.com` e declara `GUARDIAN_V2_WRITE_ENABLED: 'false'`. Já `guardiao-v2-moderator-runner.yml` usa a identidade `guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com` para triagem **e também para ativação manual da política**. Ambos usam token com validade configurada em 300 segundos, `create_credentials_file: false` e checkout com credenciais não persistidas.

**Controles do executor:** as rotinas de escrita verificam evento, repositório, `main`, `GITHUB_WORKFLOW_REF`, flags de aprovação, token e tentativa; a rotina confirma a política Firestore e a versão da política antes do commit. O código limita casos a 2 por ciclo / 12 por dia e verifica operações permitidas na transação não punitiva. **Essas verificações são da aplicação, não limites suficientes do IAM**, caso o token de escrita seja usado por código malicioso.

## 2. Evidências da execução natural

Três execuções agendadas em 14/11/2026 foram lidas **sem disparar novos runs**:
- [Run 43592631535](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43592631535) às 12:00 UTC (09:00 Fortaleza): `GUARDIAN_V2_WRITER NONPUNITIVE_CYCLE_OK cases=0 examined=0`.
- [Run 43588331249](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43588331249) às 11:05 UTC (08:05 Fortaleza): mesmo resultado.
- [Run 43583958318](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43583958318) às 10:09 UTC (07:09 Fortaleza): mesmo resultado.

Em cada uma, a autenticação Google WIF e a execução do script foram concluídas com sucesso, mas **zero documentos foram examinados e zero casos processados**. O teste de observação [43587526189](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43587526189) terminou `GUARDIAN_V2_SHADOW PAUSED_BY_POLICY documents=0 possibleSignals=0`. Esses registros não provam escrita efetiva nem ausência absoluta de operações em outros períodos. O **título** do fluxo de triagem ainda contém “desligada até homologação”, embora agendamentos com credencial sejam executados: etiqueta operacional desatualizada.

## 3. Riscos ainda em aberto (sem mutação da produção)

| Risco | Prioridade | Evidência | Contenção recomendada |
| --- | --- | --- | --- |
| Alcance do papel Firestore de escrita | Alta | Script pretende conceder `datastore.entities.create/update` via binding no **projeto**. Esse escopo não limita o token a `guardian_cases`, `guardian_audit` ou `guardian_notices`. | Auditar binding efetivo, principal e permissões de IAM; estudar API intermediária com validação server-side, ou isolamento dos recursos do Guardião, em mudança separada homologada. |
| Ambiente de produção não verificado externamente | Alta | O workflow declara `environment: guardian-v2-production-moderation`, mas o repositório não comprova reviewers, restrição de implantação ou bypass do ambiente em GitHub Settings. | Conferir políticas reais do ambiente e exigir aprovação humana onde apropriado, sem interromper agendamentos unilateralmente. |
| Mesmo principal de ativação e de triagem | Média-alta | Dois jobs diferentes compartilham a mesma service account `guardian-v2-writer`. | Avaliar separar ativação manual da política em identidade/ambiente exclusivos, com IAM mínimo e revisão. |
| Provedor real pode divergir do script | Alta | `--apply` valida estado na execução manual, mas não há verificação atual da configuração GCP, papéis adicionais, chaves permanentes ou outros bindings. | Consultar read-only o provider, role, conta e bindings reais, com titular; reconciliar sem alteração automática. |
| Revisão de supply chain | Média | `actions/checkout@v4` e `google-github-actions/auth@v3` são referências por tag na rota de produção. | Planejar pinning por SHA imutável após validação, sem alterar deploy de imediato. |
| Título versus execução | Média | Workflow agendado com título “desligada até homologação”; logs confirmam que o job de WIF foi executado. | Corrigir nomenclatura após decisão sobre autorização/operacionalização, em PR separada. |

**Limite de escopo:** o Firestore IAM para acesso servidor é distinto das regras de segurança de clientes móveis. Não tratar o guard de código como limite externo inviolável nem considerar o sucesso de autenticação prova de privilégios mínimos.

## 4. Novos testes obrigatórios, sem credenciais

O arquivo `scripts/test_guardian_v2_wif_contract.py` acrescenta **15 testes exclusivamente offline** com verificação da configuração atual e mutações negativas em memória. Fazem parte tanto de `Detectar segredos em arquivos e histórico Git` como de `Regras de seguranca Firestore`. Os testes rejeitam regressões de IDs de origem, condição WIF, permissão de exclusão, provedor/conta, ambiente, tempo de token, credenciais persistidas, flags de aprovação, modo manual da ativação, identidade do observador, barreira de escrita e formato de transação.

O teste **não consulta** as APIs de Google Cloud, GitHub Actions, Firestore ou Cloudflare e **não cria credenciais**, documentos ou eventos. É um **contrato estático de fontes**, não um parser completo YAML nem verificação direta de IAM.

## 5. Próxima auditoria externa (somente leitura, sem credenciais compartilhadas)

O proprietário, por conta administrativa no Google Cloud Shell, deve confirmar os campos implantados com comandos equivalentes a:

```bash
gcloud iam workload-identity-pools providers describe github-moderator --workload-identity-pool=guardian-v2-writer --location=global --project=atrio-catolico --format='json(attributeCondition,attributeMapping)'
gcloud iam roles describe guardianV2CaseWriter --project=atrio-catolico --format='json(includedPermissions)'
gcloud iam service-accounts get-iam-policy guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com --project=atrio-catolico --format=json
gcloud projects get-iam-policy atrio-catolico --format=json
```

**Não executar** `--apply`, `add-iam-policy-binding`, `update-oidc`, `delete`, `roles update`, mudanças em Firestore, agendamentos, IAM ou credenciais sem autorização específica. Não copiar tokens, segredos ou dados pessoais para tickets/logs. Idealmente comparar o resultado sem divulgar bindings de terceiros.

## 6. Critérios para integrar esta PR documental

- 15 testes novos e existentes aprovados no check de segredos e no de Firestore.
- CodeQL (quatro linguagens e agregado), Android, versão, política de dependências e bloqueio de exclusões aprovados.
- Somente dois YAMLs de CI **não privilegiados**, novo módulo de testes e este relatório; nenhum workflow WIF, cron, serviço de produção, IAM, backups ou `main` modificados diretamente.
- **Merge somente após nova autorização expressa.** A etapa de segurança WIF permanece *parcial* até a verificação do IAM implantado e dos requisitos de autorização do ambiente.

Fontes de referência externa:
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation
- https://firebase.google.com/docs/firestore/security/iam
