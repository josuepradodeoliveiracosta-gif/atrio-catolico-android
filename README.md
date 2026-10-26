# Átrio Católico — aplicativo Android

Comunidade católica desenvolvida em Kotlin/Jetpack Compose com Firebase Authentication
e Cloud Firestore. O repositório é privado e os APKs release são assinados pelo
fluxo de GitHub Actions.

## Qual é a última versão? (fonte única, sem número congelado)

**Não use um número copiado deste README, de um chat, da última PR ou do nome de
um arquivo para declarar a versão atual.**

- **Versão integrada no código principal:** os valores `versionName` e
  `versionCode` em
  [app/build.gradle.kts da main](app/build.gradle.kts). Essa é a única fonte
  de versão do código oficialmente integrado.
- **Compilação disponível:** conferir a execução correspondente ao mesmo commit
  em [GitHub Actions](../../actions/workflows/build-apk.yml) e o artefato
  `atrio-catolico-release-assinado`. Código integrado não comprova que a
  compilação terminou ou que a instalação ocorreu.
- **Versão em desenvolvimento:** PRs e branches, como os projetos 0.19.x, são
  propostas e **não** versões já integradas.
- **Versão instalada:** conferir dentro do próprio Android em
  **Perfil > Minha conta > Átrio Católico · versão**. GitHub não consegue
  confirmar sozinho qual APK está no aparelho do proprietário.

### Consultar sempre a versão do GitHub, inclusive no Termux

Se o repositório já estiver disponível no Termux e o GitHub CLI autenticado:

```sh
python3 scripts/status_versao.py
```

A consulta padrão acessa **o GitHub remoto** e informa versão, commit e
compilação e disponibilidade do artefato release do mesmo commit, além das PRs abertas.
A consulta fixa o commit antes de ler a versão, evitando misturar resultados
quando outra atualização chega durante a consulta. O modo remoto não depende
de existir um Gradle válido na cópia local. Se não conseguir consultar
a API do repositório privado, apresenta **erro em vez de presumir uma versão antiga**.

Para conferir somente uma cópia local (que pode estar desatualizada):

```sh
python3 scripts/status_versao.py --local
```

Toda PR e atualização de `main` passa por
[`conferir-versao.yml`](.github/workflows/conferir-versao.yml), que confere
a sintaxe do Gradle e detecta regressões de `versionCode` e `versionName`: nas
PRs compara com `origin/main`; no push compara com o commit anterior ao envio.
O resultado do CI é uma verificação, não um bloqueio automático de pushes:
impedir a integração de um resultado reprovado depende das proteções da branch.

## Estado das notificações — confira a versão antes de responder

- Desde a **0.16.0**, existe uma central de notificações dentro do app.
- A **0.17.0** adicionou o recebimento opcional de FCM e registro protegido
  de tokens; isso **não** ativa um emissor automático por si só.
- A **0.18.0** adicionou verificação voluntária em segundo plano com
  WorkManager, aproximadamente a cada 30 minutos quando o Android permitir.
  Pode avisar com o aplicativo fora da tela, sem ser push instantâneo.
  Consulte [documentação do funcionamento e limites](docs/avisos-background-v0180.md).
- Recursos propostos em **0.19.0** precisam ser examinados quanto a PR,
  integração, compilação, infraestrutura e custos antes de se dizer que estão ativos.

Nenhum backend pago é ativado por este README ou pela consulta de versão.

## Compilar e instalar

1. Consulte o commit principal e a versão pelo script.
2. Entre no [workflow de APK](../../actions/workflows/build-apk.yml) e
   confira **conclusão success para o commit correspondente**.
3. Baixe o artefato **atrio-catolico-release-assinado** do workflow validado.
4. Instale o APK com o mesmo identificador `br.com.atriocatolico`, assinado
   com a mesma chave JKS permanente e com `versionCode` maior. Assim a
   atualização pode ocorrer sobre o aplicativo anterior sem desinstalação.
5. Confirme a versão efetivamente instalada em **Perfil > Minha conta**.
6. Teste as funções novas no aparelho; sucesso de compilação não substitui
   essa validação.

**Segurança:** não publicar keystore, senhas, chaves privadas nem
credenciais administrativas no GitHub, no APK ou nas conversas. Alterações
de regras e infraestrutura Firebase em produção exigem autorização separada.
O branch de backup protegido deve permanecer intocado.

## Manutenção

Consulte o [guia de manutenção](docs/manutencao.md) para configuração administrativa,
vídeo de abertura, testes e navegação da documentação. Os guias de patches
antigos foram substituídos por essas orientações.

## Histórico

O [tutorial da fase inicial (0.4)](docs/tutorial-inicial-v04.md) foi preservado
como registro histórico. Ele não descreve o estado atual do aplicativo.


