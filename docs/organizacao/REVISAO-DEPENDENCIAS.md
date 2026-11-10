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

## Bloqueio verificado na primeira execução e fallback ativo

Na PR #217, a ação nativa retornou `Dependency review is not supported on this repository`. Portanto ela fica **condicionada** à variável de repositório `ATRIO_DEPENDENCY_GRAPH_READY=true`, que somente deve ser configurada quando o proprietário confirmar a ativação de Dependency Graph. Um job ignorado **não** significa aprovação da revisão nativa.

Como fallback real, o workflow compara dois resultados `npm audit --json --package-lock-only` obtidos na mesma execução, para o lockfile de `tests/security` na base e na PR. Introdução de advisory npm alto/crítico reprova o job; riscos preexistentes são exibidos, mas não erroneamente imputados à PR. Um erro de registry ou JSON inválido reprova a verificação, não vira sucesso silencioso. Nenhum pacote é atualizado automaticamente. A Dependency Review nativa continua pendente, assim como a comparação de vulnerabilidades de Gradle/Actions por API.

## Retomada da verificacao nativa em 10/11/2026

O proprietario confirmou a ativacao do Dependency Graph. A condicao
`ATRIO_DEPENDENCY_GRAPH_READY` foi retirada: o job de Dependency Review
volta a executar **em todas as PRs**. A falha da API ou um advisory
alto/critico introduzido pela PR deve resultar em falha, jamais em
`skipped` ou sucesso sintetico. O fallback npm segue ativo e independente.

A ativacao foi informada pelo proprietario; a integracao disponivel
nao permite ler diretamente a configuracao administrativa. A
**execucao efetiva** do Dependency Review no Actions e a verificacao
do SHA correto determinarao a conclusao desta etapa.
