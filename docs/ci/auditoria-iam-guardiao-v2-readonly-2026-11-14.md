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
   ```

3. **Antes de executar o auditor**, compare o SHA exibido com o commit da PR. Depois de inspecionar o código, execute somente:

   ```bash
   python3 -m scripts.guardian_v2_iam_readonly_audit
   ```

    **Não execute** `scripts/guardian-v2-provision-wif.sh --apply` nem cole a saída bruta de `gcloud` em conversas, issues ou arquivos públicos. Compartilhe, se desejar, **somente os nomes dos controles e seus estados resumidos**.

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


## Complemento — verificação GitHub após restrição à main

Em **14/11/2026 às 11h11, hora de Fortaleza**, o proprietário aplicou por `gh api` uma política de deployment personalizada no environment `guardian-v2-production-moderation`, permitindo somente o padrão exato `main`. Uma captura mostra o POST respondendo `main` e o GET de validação concluindo com sucesso. O assistente não dispõe de escrita/leitura administrativa diretamente nesse endpoint.

**Verificador sem credenciais e exclusivamente GET:** `scripts/guardian_v2_environment_readonly_audit.py`. Ele consulta os metadados públicos do environment, a lista de branches autorizadas, a lista de execuções naturais de `guardiao-v2-moderator-runner.yml` e, quando existir uma execução elegível, os jobs desse run. Não executa `workflow_dispatch`, não autentica em Google Cloud e não consulta documentos de usuários.

No **Termux** (Android), numa cópia isolada da *branch desta PR* e após conferir o SHA de HEAD mostrado pelo GitHub:

```bash
pkg install python -y
python3 -m scripts.guardian_v2_environment_readonly_audit
```

Resultados exibidos, **sem objetos JSON originais ou tokens**:

- `ambiente_main: OK` somente se a política estiver ativa, houver **exatamente uma** branch autorizada, de nome e tipo exatos `main`, e não aparecerem regras de revisão ou de espera inesperadas.
- `execucao_pos_mudanca: PENDENTE` enquanto não surgir uma execução agendada iniciada **após 14:12 UTC de 14/11/2026**, de forma conservadora desconsiderando o minuto da transição.
- `execucao_pos_mudanca: OK` somente quando o **run agendado elegível mais recente** e o job `Casos, auditoria e avisos — sem quarentena` estiverem concluídos com sucesso na `main`.
- `REVISAR` significa desvio efetivo do contrato consultado; `INCONCLUSIVO` significa dado ausente ou leitura impossível (incluindo 403 ou limite de requisições), **nunca** aprovação por ausência de evidência.

A verificação usa apenas API pública REST GET, sem nenhuma credencial GitHub. Se o ambiente ou as informações dos jobs não forem públicos para a conta utilizada, interrompe de modo seguro com `INCONCLUSIVO`. O script não verifica `can_admins_bypass` nem elimina o risco de permissões amplas por IAM Firestore. Ele não prova que documentos reais foram processados, apenas a execução agendada do job e seus checks. **Nenhuma execução deve ser disparada manualmente para forçar um resultado `OK`**.

A suíte `scripts/test_guardian_v2_environment_readonly_audit.py` cobre a política correta, branches extras, status de jobs e execução anterior à mudança, além de falhas de leitura e ausência de credenciais. A suíte é executada pelo check obrigatório de segurança, sem fazer chamadas à rede durante os testes.
