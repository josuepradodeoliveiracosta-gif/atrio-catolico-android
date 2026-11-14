# Guardião V2 — conferência do IAM implantado sem modificar produção

**14/11/2026.** Complemento à [auditoria WIF da PR #284](auditoria-wif-guardiao-v2-2026-11-14.md). Este procedimento não é autorização para alterar IAM, Firestore, cron, secrets, ambientes GitHub ou backups.

## Objetivo e limites

Confirmar **por leitura** se o projeto e a identidade `guardian-v2-writer` correspondem ao contrato do repositório. O script `scripts/guardian_v2_iam_readonly_audit.py` faz **somente oito consultas fixas `gcloud`** de leitura: projeto, pool, provider OIDC, papel customizado, service account, política da conta, política direta do projeto e lista de **chaves gerenciadas pelo usuário**. Ele não obtém tokens, não dispara workflows, não acessa documentos Firestore e não imprime JSON IAM, stderr, membros ou credenciais.

O programa imprime `OK`, `REVISAR` ou `INCONCLUSIVO` para cada controle. `REVISAR` ou `INCONCLUSIVO` resultam em exit code `2`; resultados `OK` resultam em `0`, **sem concluir que o sistema está seguro**. A ausência de uma credencial de leitura válida também torna a auditoria inconclusiva. O acesso às APIs depende das permissões já concedidas ao proprietário; não elevar privilégios para fazê-la passar.

## Como executar pelo celular, no Google Cloud Shell

1. No navegador Android, abra o [Cloud Shell do Google Cloud](https://shell.cloud.google.com/) na conta que administra `atrio-catolico`. Confirme que o projeto selecionado é o correto. Não envie capturas contendo configurações sensíveis.
2. Inspecione a PR e o código antes de executar. Na Cloud Shell, obtenha uma cópia isolada da branch da PR (não é a `main`):

   ```bash
   git clone --depth 1 --branch audit/guardian-v2-iam-readonly-20261114 https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android.git
   cd atrio-catolico-android
   git rev-parse HEAD
   python3 -m scripts.guardian_v2_iam_readonly_audit
   ```

3. Compare o SHA exibido com o commit da PR. **Não execute** `scripts/guardian-v2-provision-wif.sh --apply` nem cole a saída bruta de `gcloud` em conversas, issues ou arquivos públicos. Compartilhe, se desejar, **somente os nomes dos controles e seus estados resumidos**.

O script consulta exclusivamente o projeto `atrio-catolico` e para antes das demais consultas caso o número do projeto não seja o esperado. Não requer token do GitHub, assinatura de APK ou acesso ao Firebase de testes.

## Interpretação

- `condicao_wif`, `emissor_oidc` e `mapeamento_wif` verificam características do provedor **efetivamente consultado**. Condição divergente não é corrigida automaticamente.
- `permissoes_papel` rejeita permissões extras, inclusive exclusão; `papel_projeto` verifica que a identidade recebe o papel esperado no projeto; `papeis_extras_projeto` sinaliza outras concessões diretas visíveis.
- `vinculo_wif_conta` compara o principal autorizado e `acessos_extras_conta` pede revisão de concessões adicionais; `chaves_usuario_ausentes` procura chaves permanentes gerenciadas por usuários.
- Mesmo se todos os controles retornarem `OK`, o papel do projeto inclui `datastore.entities.create/update` e **não restringe coleções** Firestore. A auditoria não comprova IAM herdado de pastas/organização, IAM efetivo via grupos, autorização de terceiros, proteção de outras contas ou escopo de acesso por documento.

## GitHub — segunda dependência, verificação humana

No navegador Android, abra o repositório e entre em **Settings → Environments → guardian-v2-production-moderation**. Registre, sem dados pessoais: existência do ambiente, required reviewers, prevent self-review, branch deployment restrictions, bypass e wait timer. **Não salve alterações.** A conexão GitHub usada nesta auditoria não tem leitura administrativa dessa tela. Um cron que use o ambiente pode aguardar aprovação se houver required reviewers; não habilitar aprovação obrigatória sem analisar o efeito nos jobs existentes. Consulte a [documentação oficial dos ambientes](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## Critérios restantes da etapa 3/7

- [ ] Executar auditoria no Google Cloud autorizado e registrar somente os estados resumidos, sem políticas completas nem tokens.
- [ ] Conferir as regras reais do ambiente GitHub sem modificá-las.
- [ ] Avaliar risco de escrita no escopo do projeto e separação entre ativação manual e triagem agendada; propor eventual correção **em PR separada** e homologação antes de produção.

**Estado nesta PR:** auditor e testes offline preparados; **nenhuma auditoria remota do IAM foi executada**. Não contar a etapa 3 como concluída apenas porque o script existe ou seus testes passam.
