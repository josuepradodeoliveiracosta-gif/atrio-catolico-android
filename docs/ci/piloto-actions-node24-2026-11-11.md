# Piloto de modernização oficial das Actions (etapa 5/5)

2026-11-11. **Apenas proposta isolada em PR**; não há autorização para merge ou deploy.

## Contexto e evidências

Os logs de Android e CodeQL continuam contendo o aviso de descontinuação de Node.js 20 para certas Actions. A migração de Actions internas para Node.js 24 não exige mudar a versão do Node usada pelos testes do aplicativo.

Documentação oficial, consultada em 2026-11-11:
- [actions/checkout — versões 5, 6 e 7](https://github.com/actions/checkout/blob/main/README.md): uso de Node.js 24 desde v5; v7 protege cenários de fork com eventos privilegiados `pull_request_target` e `workflow_run`; runner compatível deve estar atualizado.
- [actions/setup-node — versão 7](https://github.com/actions/setup-node/blob/main/README.md): implementação ESM, utiliza Node.js 24 internamente desde v5; v6 pode ativar cache npm automaticamente ao detectar `packageManager` no manifesto. Usar `package-manager-cache: false` no piloto sem lockfile.
- [actions/setup-java — versão 6](https://github.com/actions/setup-java): Node 24 desde v5, suporte v6; **fora deste piloto** por envolver compilação Android e Firebase Emulator.
- [actions/upload-artifact — versão 6/7](https://github.com/actions/upload-artifact/releases): Node.js 24 desde v6; **fora deste piloto** por envolver artefatos de APK e relatórios.

## Modificações limitadas ao Guardião offline

`.github/workflows/guardiao-v2-motor-ci.yml`: atualizar somente `actions/checkout@v4 → @v7` e `actions/setup-node@v4 → @v7`. Conservar `node-version: '22'`, pois é a versão do processo de testes Node do projeto e não o runtime interno da Action. Definir explicitamente `package-manager-cache: false` para não permitir ativação automática futura.

O job permanece `contents: read`, `persist-credentials: false`, sem secrets, Firebase/Cloudflare, APIs de produção, deploy, release ou assinatura. Seus testes `npm run check` e `npm test` seguem inalterados, inclusive variáveis de produção forçadas para `false`.

Um contrato adicional em `scripts/test_ci_optimization_contract.py` integra a validação ao check obrigatório `Regras de seguranca Firestore`, além de o workflow Guardião disparar por alteração no próprio YAML.

## Critérios de aceite e limitação

- Workflow Guardião completo e aprovado na PR, incluindo todos os testes Node offline.
- Cinco checks obrigatórios da `main` e quatro linguagens CodeQL aprovados; nenhum novo aviso grave, thread ou mudança de permissão.
- Confirmar runner GitHub-hosted compatível com actions v7 (Node.js 24); não usar o piloto em self-hosted desconhecido.
- Comparar duração e logs com workflow anterior antes de generalizar. O objetivo principal é **compatibilidade e manutenção**, não prometer ganho de tempo com a troca de major version.
- A migração completa das outras Actions deve ser **gradual e em PRs separadas**, sobretudo CodeQL, Gradle, Android, artefatos e release. Não alterar sua assinatura nem regras de produção.

Não atribuir nota 9,5 sem desempenho consistente e segurança verificada. O piloto prova apenas a compatibilidade da seleção de Actions testadas.
