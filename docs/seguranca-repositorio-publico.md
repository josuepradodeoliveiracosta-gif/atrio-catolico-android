# Plano de segurança para o repositório público do Átrio Católico

## Evidências verificadas (2026-10-28)

- Repositório `josuepradodeoliveiracosta-gif/atrio-catolico-android` ficou público.
- Versão integrada na `main`: **0.18.0**; branch de homologação 0.19.0 e PR #15 permanecem separadas.
- A `main` foi consultada como **sem proteção** na API GitHub (`protected: false`). A integração desta documentação **não ativa** uma ruleset por conta própria.
- `app/google-services.json` contém a configuração de cliente Firebase, usada no APK. A API key do app é recuperável de qualquer APK, mesmo que o arquivo seja removido do repositório. Segurança depende das regras Firestore/Auth, App Check e restrições adequadas da chave.
- Os workflows já utilizavam `permissions: contents: read`. Na atualização proposta, a assinatura release não roda mais automaticamente a cada push na `main`.
- Não foi feita auditoria histórica forense completa de todos os commits, forks, releases, caches ou logs. Um scanner de padrões comuns do conteúdo atual **não prova** que nenhum segredo jamais foi exposto.

## Passos imediatos que exigem a conta proprietária

### 1. Proteger a branch `main` — PRIORIDADE CRÍTICA

Abra **Settings → Rules → Rulesets** do repositório (ou **Branches → Add branch protection rule**, conforme a interface).

Crie uma ruleset **ativa** para `main`:
- exigir Pull Request para integrar mudanças;
- impedir force-push e exclusão da branch;
- exigir verificações de status bem-sucedidas antes do merge (selecione os checks reais do CI que aparecem após a execução, incluindo Segurança do repositório público, Regras de seguranca Firestore, Compilar Android de testes e Evitar regressão de versão);
- restringir bypass; não permitir que colaboradores comuns ignorem as regras;
- se houver um segundo colaborador confiável, exigir revisão antes do merge. O proprietário único pode ficar bloqueado se exigir uma aprovação que ele mesmo não consegue fornecer.

A ruleset deve realmente mostrar **Active**. A criação no GitHub não está automatizada por esta PR.

### 2. Separar a chave de assinatura dos builds comuns

Abra **Settings → Environments → New environment → `release`**:
- restrinja deployment branches à branch protegida `main`;
- configure aprovação por revisor de confiança, se disponível;
- conserve o keystore e senhas apenas em GitHub Actions Secrets/Environment Secrets;
- execute manualmente o workflow **Gerar APK do Atrio Catolico**, selecionando a branch `main`, apenas após verificar o commit e a assinatura.

A PR introduz job `apk-release` condicionado a `workflow_dispatch` na `main` e com `environment: release`. O APK debug continua disponível em push de `main`, mas **não recebe** segredos de assinatura.

Não regenere o keystore, não altere o `applicationId` e preserve o backup histórico sem modificações.

### 3. Segurança do GitHub e das credenciais

Em **Settings → Actions → General**, ajuste o `GITHUB_TOKEN` padrão para **Read repository contents and packages permissions**. Restrinja actions a editores confiáveis e mantenha aprovação de workflows de contribuintes externos.

Em **Settings → Security / Code security and analysis**, habilite conforme sua conta permitir:
- Secret scanning e push protection;
- Dependency graph, Dependabot alerts e Dependabot security updates;
- Code scanning / CodeQL para Java/Kotlin, JavaScript e Python, quando disponíveis.

Ative autenticação de dois fatores/passkeys na conta GitHub. Verifique colaboradores, GitHub Apps instaladas e chaves de deploy.

Se houver suspeita de vazamento: **revogue e rotacione primeiro as credenciais**, incluindo tokens Cloudflare, chaves Firebase Admin, webhook credentials e segredos de workflows. Apagar o arquivo em um commit novo não remove o segredo de commits anteriores ou clones; reescrever histórico exige planejamento e não substitui a revogação.

### 4. Firebase e Cloudflare em produção

- No Google Cloud IAM, revise a identidade de serviço usada pelo Worker. O papel `roles/datastore.user` fornece leitura e escrita de dados amplas: use uma conta separada de QA e conceda o **mínimo** necessário, evitando `Owner`/`Editor`.
- No Firestore, confira se as regras realmente **publicadas** correspondem ao código aprovado em `firestore.rules` e se usuários comuns não têm permissão de ler `reports`, `admins` ou `pushDevices` de terceiros.
- Revise as configurações do Firebase Authentication, domínios autorizados, cotas de Identity Toolkit, App Check e regras contra criação abusiva de contas.
- Revise as **API key restrictions** no Google Cloud; restrinja a chave aos serviços Firebase necessários sem bloquear o aplicativo. Nunca suponha que a API key pública seja autorização administrativa.
- No Cloudflare, proteja secrets do Worker, limite os bindings D1/Queues, revise origens autenticadas e permissões de deploy. `QA_MANUAL_ENABLED` deve permanecer desligado exceto durante uma sessão autorizada.
- Certifique-se de que o endpoint de moderação exige ID token válido e aplica autorização do servidor; não exponha rotas de administração sem autenticação.

### 5. Verificações automáticas desta PR

- `scripts/security_audit.py`: alerta sobre padrões comuns de chaves/tokens e caminhos proibidos rastreados no Git; não imprime conteúdos sensíveis.
- `.github/workflows/security-audit.yml`: roda scanner no push/PR e testes unitários do detector.
- `.github/dependabot.yml`: inspeciona atualizações semanais de GitHub Actions, Gradle e npm.
- `.gitignore`: bloqueia arquivos `.env`, `.dev.vars`, credenciais administrativas, keystores e arquivos privados.
- `.github/workflows/build-apk.yml`: mantém compilações debug sem secrets e exige início manual em `main` para assinatura release.

**Limitações:** um `.gitignore` não apaga arquivos já versionados; um scanner de código não detecta todas as credenciais nem explorações; CI que passou não garante segurança de produção. Execute o Secret Scanning oficial do GitHub e reveja o histórico Git.

## Checklist após a integração

- [ ] Ruleset ativa na `main` e teste de bloqueio de push direto.
- [ ] Environment `release` restrito à `main`.
- [ ] Workflow de segurança e CI aprovados, sem ignorar falhas.
- [ ] Secret scanning/push protection e Dependabot alerts ativos.
- [ ] Contas IAM, Firebase/Firestore e Cloudflare revisadas.
- [ ] Segredos suspeitos revogados e rotacionados.
- [ ] PR #15 (v0.19.0) reavaliada com os mesmos controles **antes** de merge.
