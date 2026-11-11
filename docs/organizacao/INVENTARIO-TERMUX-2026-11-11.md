# Inventário do Termux — organização local em 11/11/2026

> **Escopo:** diretórios locais do projeto Átrio Católico no Termux Android. Este registro descreve as saídas e verificações exibidas pelo operador no Termux durante a reorganização de 11/11/2026; **não** resulta de acesso remoto ao telefone nem de execução de testes pelo GitHub. Não inclui arquivos privados, conteúdo de regras de produção, credenciais, hashes secretos ou chaves.

## Estado confirmado após a reorganização

- Diretórios com prefixo `atrio*` diretamente em `$HOME`: **14** (consulta final do operador).
- Diretórios retirados da raiz e **arquivados sem exclusão**: **18**.
- Dez repositórios Git examinados apresentaram `Git acessivel`; a inspeção apenas confirma acesso e estado local, não valida sincronização com `origin/main`, CI, APK, deploy ou operação do aplicativo.
- Cópia do laboratório Guardião comparada com o original: `OK: GUARDIAO PRESERVADO`.
- Existência da chave de assinatura no Termux: `OK: ASSINATURA PRESENTE`; apenas presença, não validação do certificado ou das senhas.
- Diretório de backups: `OK: BACKUPS PRESENTES`; apenas presença, não teste de restauração.
- Não houve exclusões, deploy Firebase, execução de scripts administrativos ou alteração do repositório GitHub durante a reorganização local.
- Dependências `node_modules` de aproximadamente **377 MB** (limpeza) e **259 MB** (testes de e-mail) ficaram preservadas nos originais arquivados; **não** houve economia desse espaço.

### Pastas ainda na raiz `$HOME`

| Pasta | Destinação atual | Precaução |
| --- | --- | --- |
| `atrio` | cópia Git local | manter até validar papel e sincronização |
| `atrio-catolico-android` | cópia Git de desenvolvimento | não presumir que sua branch seja `main` |
| `atrio-auditoria` | repositório Git de auditoria | preservar itens locais não rastreados |
| `atrio-firestore-deploy` | repositório Git de Firebase | preservar arquivo de backup não rastreado; não fazer deploy |
| `atrio-ota-servidor` | repositório Git de OTA | preservar |
| `atrio-play-qa` | repositório Git de QA Play | preservar |
| `atrio-privacy-qa` | repositório Git de QA privacidade | preservar |
| `atrio-qa-app` | repositório Git de QA aplicativo | preservar |
| `atrio-selos-v2-auditoria` | repositório Git de auditoria de selos | preservar |
| `atrio-guardiao-qa-firebase` | laboratório QA com `repo/.git` interno | cópia QA comparada; original mantido |
| `atrio-workspaces` | raiz dos ambientes de trabalho | inclui `qa-cadastro`, repositório Git próprio |
| `atrio-operacoes` | relatórios, ferramentas e histórico | não tratar cópias como arquivos a apagar |
| `atrio-assinatura` | chave privada da assinatura Android | **não mover nem versionar** |
| `atrio-backups` | backups locais | **não remover sem política de retenção e restauração** |

Pastas normais do Termux, por exemplo `~/.config`, `~/.ssh`, `~/.termux` e `~/storage`, não integram a contagem de `atrio*` e não foram reorganizadas.

## Estrutura lógica depois da consolidação

```text
$HOME/
├── atrio-catolico-android/         # cópia Git de desenvolvimento
├── atrio/                          # cópia Git adicional
├── atrio-auditoria/                # Git, arquivos OTA não rastreados
├── atrio-firestore-deploy/         # Git, backup local de regras não rastreado
├── atrio-ota-servidor/             # Git
├── atrio-play-qa/                  # Git
├── atrio-privacy-qa/               # Git
├── atrio-qa-app/                   # Git
├── atrio-selos-v2-auditoria/       # Git
├── atrio-guardiao-qa-firebase/     # contém repo/.git; original mantido
├── atrio-workspaces/
│   ├── qa-cadastro/                # Git existente
│   ├── desenvolvimento/            # categoria criada
│   ├── qa/
│   │   ├── testes-email/           # sem node_modules
│   │   ├── atrio-qa-auth/
│   │   ├── atrio-qa-auth-setup/
│   │   ├── atrio-qa-firestore/
│   │   └── atrio-guardiao-qa-firebase/ # cópia com Git interno
│   └── homologacao/
│       ├── atrio-ota-homologacao/
│       ├── ota-lab/
│       └── ota_qa_loopback_server.py
├── atrio-operacoes/
│   ├── auditorias/
│   │   ├── atrio_auditoria_runs_*/ # duas cópias verificadas
│   │   └── atrio-admin-auditorias/
│   ├── ferramentas/
│   │   └── implantacao-email-*/   # cópia da implantação administrativa
│   └── historico/
│       ├── atrio_actions_preservacao/
│       ├── atrio-limpeza/          # cópia sem node_modules
│       ├── versoes-locais/         # nove pastas históricas copiadas
│       └── originais-raiz/         # 18 originais movidos e preservados
├── atrio-assinatura/               # protegida
└── atrio-backups/                  # protegida
```

Este desenho **não** indica que as cópias Git sejam duplicadas ou que alguma delas possa ser apagada. Branches e commits diferem.

## Relação das 18 pastas retiradas da raiz

Originais mantidos em `$HOME/atrio-operacoes/historico/originais-raiz/<nome>`, após verificações da cópia de destino:

| Grupo | Pastas (nomes originais) | Cópia organizada |
| --- | --- | --- |
| Auditorias (2) | `atrio_auditoria_runs_20261110_004829`, `atrio_auditoria_runs_20261110_004959` | `atrio-operacoes/auditorias/` |
| Actions (1) | `atrio_actions_preservacao` | `atrio-operacoes/historico/atrio_actions_preservacao/` |
| Homologação OTA (1) | `atrio-ota-homologacao` | `atrio-workspaces/homologacao/` |
| Ferramentas de limpeza (1) | `atrio-limpeza` | `atrio-operacoes/historico/atrio-limpeza/`, exceto `node_modules` |
| Administração (1) | `atrio-admin` | auditorias, testes de e-mail e implantação separados nas categorias; testes sem `node_modules` |
| Histórico de regras/versões (9) | `atrio-ativacao-0196`, `atrio-cadastro-v2-regras-20261106`, `atrio-conferencia-0196`, `atrio-implantacao-selos`, `atrio-painel-selos-0140`, `atrio-pr35`, `atrio-pr39-regras`, `atrio-push-0170`, `atrio-regras-0194` | `atrio-operacoes/historico/versoes-locais/` |
| QA sem Git (3) | `atrio-qa-auth`, `atrio-qa-auth-setup`, `atrio-qa-firestore` | `atrio-workspaces/qa/` |

Outras cópias foram preservadas **sem retirar os originais**: `atrio-auditoria/ota-lab/` e `ota_qa_loopback_server.py` em `atrio-workspaces/homologacao/`, e o laboratório `atrio-guardiao-qa-firebase/` em `atrio-workspaces/qa/`.

### Verificações realizadas e limites

- `cp -a`, `diff -qr` e `cmp -s` foram usados nas verificações reportadas pelo operador.
- O laboratório OTA comparado exibiu `OK: LABORATORIO INTEGRO`; o script Python copiado apresentou sintaxe AST válida. **Não** houve execução funcional do servidor. O script exige `--apk` e pode interpretar caminhos relativos segundo o diretório de execução; preferir caminhos absolutos.
- A integridade do Guardião foi conferida por comparação e seu repositório Git interno mostrou a mesma branch e commit em ambas as cópias, sem alterações locais. **Não** houve execução de testes Firestore.
- No repositório `atrio-auditoria`, `ota-lab/` e `ota_qa_loopback_server.py` estavam não rastreados. Em `atrio-firestore-deploy`, `firestore.rules.producao-backup` estava não rastreado. **Não** remover ou adicionar esses itens ao Git sem revisão específica.
- A comparação SHA-256 revelou múltiplas versões distintas de `firestore.rules` em pastas locais. Conteúdo idêntico **não** demonstra que regras foram publicadas no Firebase. A versão vigente em produção não foi confirmada.
- Pesquisas de referências em scripts e documentação foram parciais. Referências textuais como `atrio-regras-0194` podem ser históricas, mas nenhuma busca limitada garante que um caminho antigo não seja usado por ferramentas externas.
- Nenhuma exclusão ampla, `git reset`, `force-push`, modificação em backup protegido ou movimento de chaves está autorizada por este documento.

## Operação e reversão controlada

1. Antes de usar um ambiente movido, confirmar o diretório atual, parâmetros, arquivos necessários e eventual configuração externa. Quando houver scripts que apontem para `$HOME/<nome-antigo>`, revisar e homologar antes de executar.
2. Para localizar originais preservados, consultar `$HOME/atrio-operacoes/historico/originais-raiz/`; **não** mover de volta automaticamente se o caminho de destino já estiver ocupado.
3. Antes de uma restauração, verificar `cmp`/`diff`, estado Git, espaço disponível e potenciais conflitos. Fazer a restauração individual, reversível e com autorização explícita.
4. Não copiar a chave `.jks`, senhas, credenciais Firebase, logs sensíveis, backups de produção ou dados privados para este repositório público. Veja [Assinatura permanente](../../README_ASSINATURA_PERMANENTE.md) e [Segurança](../../SECURITY.md).
5. Manter a documentação separada dos testes operacionais; a passagem de uma PR documental para `main` não comprova funcionamento de QA, deploy ou APK.

## Verificações ainda pendentes

- Homologação funcional dos testes de e-mail, laboratório OTA, Guardião e demais ambientes QA nas novas localizações.
- Conferência completa de scripts externos, tarefas agendadas e caminhos fora dos diretórios pesquisados.
- Política de retenção, backup externo e ensaio de restauração antes de eventual exclusão de cópias.
- Decisão posterior sobre consolidação de cópias Git, somente após comparar remotos, commits, branches, alterações locais e dependências.
- Integração desta documentação após revisão de PR; **não** alterar `main` diretamente.

*Fonte das contagens e status: saídas e capturas do Termux fornecidas pelo operador em 11/11/2026. Estado pontual, sujeito a mudanças posteriores no aparelho.*
