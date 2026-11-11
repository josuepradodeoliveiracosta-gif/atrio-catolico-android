# Etapas 3 e 4 — caches e seleção real de Workers

Data: 2026-11-11. Escopo: **sem alterações em cache de produção**, sem modificar Workers, backups, credenciais, regras do GitHub ou deployments.

## Etapa 3 — diagnóstico dos caches (manter configuração atual)

Foram inspecionados **8 logs de jobs** de Android e Kotlin CodeQL antes/depois da otimização, incluindo:
- [CodeQL PR novo, run 43044092851](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43044092851).
- [CodeQL PR anterior, run 43036577310](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43036577310).
- [CodeQL main, run 43037350618](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43037350618).
- [CodeQL PR com espera elevada, run 42949257642](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949257642).
- [APK main depois, run 43037350557](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43037350557).
- [APK main antes, run 42949024618](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949024618).
- [Selos PR novo, run 43044092890](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43044092890).
- [Selos PR anterior, run 43036578036](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43036578036).

**Resultado dos logs:** 8/8 com entradas de cache hit do Gradle, incluindo dependências, transformações, Gradle 8.13 e Kotlin/Groovy DSL; não foi observado cache miss nos registros selecionados. Isso comprova **reutilização observada**, não taxa de acerto universal nem economia de tempo atribuível ao cache.

**Decisão:** manter o cache Gradle existente e o cache npm configurado. Uma nova chave/global cache ou cache de saída de build pode introduzir cache poisoning, inconsistências de análise CodeQL ou custo de restauração sem ganho. Não mudar apenas para aumentar nota ou quantidade de linhas alteradas. Revisar se futuras medições indicarem falhas reais.

## Etapa 4 — seleção inteligente dos Workers

O seletor atual (`scripts/ci_worker_scope.py`) usa `git merge-base` de um ancestral verificável e `git diff --no-renames -z`, limitado em tamanho. Arquivo apenas em `cloudflare/avatar-worker/**` seleciona Avatar; só em `cloudflare/push-worker/**` seleciona Push. Mudanças de arquivos compartilhados em `cloudflare/`, infraestrutura relacionada, diff inválido e acionamento manual executam ambos, **preservando o fail-closed**.

Observações reais [43034658412](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43034658412) e [43036577566](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43036577566) selecionaram corretamente **Avatar e Push**, pois a PR alterava o próprio workflow/seletor. Não é evidência real de PR apenas Avatar ou Push.

### Testes de integração offline adicionados

`scripts/test_ci_worker_scope_integration.py` cria um repositório Git efêmero em diretório temporário, com histórico real, e verifica:

1. Alteração só Avatar + documento não relacionado → somente Avatar
2. Alteração só Push → somente Push
3. Política de e-mail compartilhada → ambos
4. Exclusão de arquivo Avatar → somente Avatar
5. Renomeação entre Avatar e Push → ambos (`--no-renames`)
6. Renomeação da política compartilhada → ambos
7. Alteração apenas de documentação → fallback ambos, sem deixar de compilar Worker por engano se o seletor for invocado manualmente

O workflow de empacotamento executa os novos testes antes de compilar. O check obrigatório `Regras de seguranca Firestore` também os executa. Os testes não precisam de credenciais, acesso à Cloudflare ou arquivos de produção. **Não criamos PRs fictícias nem alterações no código dos Workers apenas para provocar builds.**

### Critérios de aceite

- Git real e fixtures existentes aprovados; cinco checks obrigatórios e CodeQL completo verdes.
- Sem mudanças de proteção, assinatura, deploy ou caches.
- Economia da seletividade em GitHub Actions remoto continua a exigir PRs reais que alterem apenas um Worker, quando surgirem naturalmente. Até lá, demonstrar apenas a lógica através de integração offline.
- Etapa 3 pode ser encerrada como **decisão fundamentada de manter cache**, não como ganho percentual de velocidade.
- Etapa 4 pode ser encerrada em nível de **regressão funcional testada**, mantendo medição de impacto em andamento.

Esta PR permanece em rascunho e não autoriza merge nem ativação de produção. A nota global 9,5 continua condicionada a avaliações depois das incorporações.
