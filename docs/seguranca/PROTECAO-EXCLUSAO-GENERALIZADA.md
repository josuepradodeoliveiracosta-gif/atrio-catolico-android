# Protecao contra exclusao generalizada — Atrio Catolico

## O que foi preparado

- Workflow `.github/workflows/proteger-repositorio.yml`: inspeciona cada PR para `main` a partir do codigo da branch base; nao executa codigo nem build da PR, nao usa segredos e tem token somente de leitura.
- Script `scripts/guard_exclusoes.py`: falha de modo fechado se nao conseguir analisar os SHAs, bloqueia 8 ou mais arquivos removidos, ou 10% dos arquivos rastreados com no minimo 3 remocoes.
- Uma unica exclusao de arquivos de backup, de workflow do GitHub, de regras/configuracoes criticas e de arquivos da propria trava tambem e reprovada.
- Tentativa de alterar o workflow da trava, o script da trava ou `.github/CODEOWNERS` em uma PR e reprovada. Alteracoes excepcionais de seguranca devem ter autorizacao expressa do fundador e procedimento administrativo controlado.
- `.github/CODEOWNERS` identifica o responsavel pelas areas sensiveis. So passa a exigir revisao se as regras do repositorio assim determinarem.
- Testes automaticos cobrem casos permitidos, limiares, adulteracao da trava, arquivos criticos e renomeacoes (`--no-renames` impede ocultar remocoes).

## Configuracao indispensavel no GitHub (proprietario/admin)

Depois de revisar e integrar esta PR, abra `Settings > Rules > Rulesets` no repositorio. Em repositorios publicos, regras para branches sao suportadas inclusive no GitHub Free, de acordo com a documentacao do GitHub.

### Ruleset 1 — branch principal `main`

1. Crie uma regra de branch ativa para a branch exata `main`.
2. Marque `Restrict deletions` e `Block force pushes`.
3. Exija pull request antes do merge (`Require a pull request before merging`).
4. Exija o status check de nome exato `Bloquear exclusoes em massa (Atrio)` em `Require status checks to pass`. Adicione o check somente depois da primeira execucao real, quando estiver disponivel na selecao.
5. Evite configuracoes de bypass automatico, principalmente para administradores. Verifique se regras existentes nao sao afrouxadas.
6. Se for o unico mantenedor, **nao** habilite aprovacao obrigatoria do proprio autor: o GitHub nao permite aprovar a propria PR. O check obrigatorio e a exigencia de PR funcionam separadamente de revisoes humanas.

### Ruleset 2 — branches historicas de backup

1. Crie uma regra ativa que selecione o padrao `backup/**` (confira no simulador de correspondencia as branches existentes).
2. Marque `Restrict deletions`, `Block force pushes` e `Restrict updates` para manter backups existentes imutaveis; evite usuarios/atores com bypass.
3. Para novas copias, use nomes de branch novos em vez de sobrescrever backups anteriores.
4. Nao exclua, renomeie, sobrescreva, faça merge forçado ou reescreva as branches de backup existentes.

### Confirmacao operacional

- Abra uma PR de teste que apague somente um arquivo de teste nao critico: deve passar se os limiares nao forem atingidos.
- Em PR separada e descartavel, simule remocao de 8 arquivos de teste, ou de um workflow: o check deve ficar vermelho, sem integrar a PR.
- Tente excluir ou forcar push na `main` e em uma branch `backup/` apenas usando a interface de regras/inspecao, sem executar operacoes destrutivas reais.
- **Importante:** a execucao de `pull_request_target` pode estar sujeita a politica de eventos de GitHub Actions. Confirme a execucao concreta no repositorio. Se estiver bloqueada, o status requerido nao deve ser dispensado: revise a politica de eventos com seguranca antes de liberar merges.

## O que esta protecao NAO faz

- O arquivo CI sozinho nao impede push direto nem exclusao de toda a conta/repo por administrador. A protecao efetiva depende do ruleset ativo e de suas permissoes.
- O CI detecta exclusoes de arquivos e alteracoes da propria trava; nao analisa semanticamente toda forma de destruicao de conteudo, nem previne comandos locais executados antes do Git.
- As regras de backup protegem referencias Git; nao substituem backup externo independente, de acesso restrito e testado para restauracao.
- Nao ha gatilho magico de palavras no servidor: a frase `Apague tudo no repositório` nunca constitui autorizacao de deletar. Qualquer destruicao requer autorizacao explicita e escopo verificavel.

## Testes locais de leitura

Execute da raiz do repositorio, em uma copia de desenvolvimento:

```bash
python3 -m unittest discover -s scripts -p 'test_guard_exclusoes.py' -v
git fetch origin main
python3 scripts/guard_exclusoes.py --base "$(git merge-base origin/main HEAD)" --head "$(git rev-parse HEAD)"
```

Esta entrega nao altera arquivos do app, Firebase, Cloudflare, chaves de assinatura, APK de producao ou branches de backup. Nao publicar ate que CI e rulesets estejam comprovados.

Fontes: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets e https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target

## Auditoria das regras que ja existem (07/11/2026)

A consulta de leitura aos rulesets revelou duas regras **ativas** antes de integrar esta PR:

- `Protecao-Main-Atrio-Catolico` (ruleset ID 26067893), abrangendo a branch padrao: ja impede exclusao/force push, exige PR (sem aprovacao de outro revisor) e exige os checks de segredos, versao, regras Firestore e compilacao Android. **Nao alterar nem remover estes checks**. Apos a integracao desta PR, **acrescentar** o check `Bloquear exclusoes em massa (Atrio)` ao conjunto exigido, somente quando sua primeira execucao aparecer no GitHub.
- `Protecao-Backup-Atrio-Catolico` (ruleset ID 26070795): impede delete, reescrita e atualizacao, mas o seletor atual inclui **somente** `refs/heads/backup/v0.12.0-2026-10-25`. Ampliar o seletor (ou criar outro ruleset ativo) para as demais branches `backup/**`, conferindo as correspondencias reais antes de salvar. A protecao atual deve ser mantida ate a nova estar eficaz.

Verificar os detalhes em `Settings > Rules > Rulesets`: [ruleset main](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/rules/26067893) e [ruleset backup](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/rules/26070795). A conexao Github disponivel permite ler esses rulesets, mas nao altera configuracoes administrativas. **Nao afirmar que o novo check e obrigatorio ou que todas as branches de backup estao protegidas sem ler novamente os rulesets.**
