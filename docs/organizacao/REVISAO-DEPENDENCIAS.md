# Revisão de dependências por Pull Request

**Melhoria 5/5 proposta em PR independente, sem alterar a main.**

O repositório já possui `.github/dependabot.yml` semanal para
GitHub Actions, Gradle e npm em `tests/security`. Essa configuração
foi preservada integralmente: não há motivo para duplicar automações.

O novo workflow executa GitHub Dependency Review em todas as PRs
dirigidas à main, sem filtros de caminhos. Modificações na árvore
de dependências que introduzam vulnerabilidades altas ou críticas
em runtime, development ou unknown reprovam o novo check.

O relatório da action aparece no GitHub Actions. O teste de contrato
offline verifica a existência dos três ecossistemas do Dependabot,
permissões mínimas, ausência de segredos e a severidade exigida.

Esse mecanismo complementa, mas não substitui, Dependabot Alerts,
Build Android e CodeQL. Ele não prova que todas as atualizações
Gradle/npm são compatíveis; os builds e testes existentes continuam
responsáveis por detectar regressões de compilação e comportamento.

É necessário ter Dependency Graph e a Dependency Review API
habilitadas no repositório. Se o job falhar por configuração
da plataforma, isso será reportado sem fingir aprovação.

Permissão: apenas `contents: read`. Nenhuma escrita em branches,
PRs, releases, Firebase, Cloudflare, produção, `main` ou backups.

Documentação:
https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action
