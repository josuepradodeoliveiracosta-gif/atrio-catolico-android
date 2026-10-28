# Manutenção do Átrio

## Código, instalação e assinatura

Consulte a versão remota com `python3 scripts/status_versao.py` e siga o
[README](../README.md) para baixar o release do mesmo commit validado.
Não recrie o repositório nem aplique patches ZIP de versões antigas.
Em uma cópia Git existente, confira `git status` antes de atualizar;
use `git pull --ff-only` somente com alterações locais já preservadas.
Se houver divergência, revise os commits em vez de forçar a atualização.

A [assinatura permanente](../README_ASSINATURA_PERMANENTE.md), o identificador
Android e o backup protegido devem ser preservados. APK debug não substitui
uma instalação release com assinatura diferente.

## Configuração administrativa

O código e as regras devem ser lidos na mesma revisão. Alterar
[firestore.rules](../firestore.rules) no GitHub não publica regras no Firebase.
Uma publicação em produção é uma operação separada, após revisão e testes;
não recupere regras de um patch antigo para substituir as atuais.

Para autorizar um administrador, o proprietário do projeto usa o Console:

1. Localize a conta no Firebase Authentication e copie seu UID.
2. Na raiz do Firestore, abra ou crie `admins/{UID}` com esse UID exato.
3. Defina `enabled` como booleano `true`; para revogar, use `false`.

Esse acesso não é concedido pelo próprio cliente e não deve ser confundido
com o selo visual de moderador. A concessão de selos segue as
[regras de selos](selos-seguranca.md) e a [revisão do clero](revisao-clero-v0140.md).

A moderação distingue denúncias de publicações e respostas. Antes de remover,
confira o alvo e registre a justificativa. Remover uma resposta deve preservar
a discussão e as demais respostas. A decisão é registrada junto com a remoção;
o app não oferece restauração do conteúdo. Excluir uma discussão não garante
limpeza recursiva de subcoleções, referências salvas ou notificações.

## Vídeo de abertura

O vídeo `app/src/main/res/raw/abertura_atrio.mp4` é um recurso local utilizado
por `OpeningVideo.kt`; não é um arquivo temporário nem um download do Firestore.
A troca do vídeo exige recompilar o aplicativo.

O proprietário controla `app_config/opening_video` no Console com o campo
`enabled`, do tipo booleano: `true` exibe, `false` desativa.
Não armazene dados privados nesse documento, cuja leitura direta é pública
pelas regras. Clientes não podem alterá-lo, inclusive administradores do app.

O pop-up só aparece após autenticação, uma vez por tarefa do aplicativo.
Fechar, terminar a reprodução ou desativar o vídeo encerra a exibição nessa
sessão. Navegar, alternar aplicativos ou sair e entrar na conta não reinicia
uma sessão já consumida. Remover dos recentes e abrir novamente permite nova
exibição após autenticação. O modo de demonstração não exibe esse vídeo.

Ausência ou valor inválido usa o padrão habilitado. Para desligar, use `false`,
não exclua o documento. Offline, vale o último valor recebido ou o padrão;
a desativação remota depende de sincronização com o aparelho.

## Validação reproduzível

Na raiz do projeto:

```sh
python3 scripts/test_status_versao.py
python3 scripts/status_versao.py --local
python3 scripts/validar_firebase.py
```

Com Node e Java instalados, os testes de regras usam um emulador com projeto
fictício, sem consultar o banco de produção:

```sh
cd tests/security
npm ci
npm test
```

O script `prepare.mjs` copia as regras atuais para o diretório de testes.
Essa cópia, logs, dependências e caches são gerados localmente e ignorados
pelo Git. Preserve `package-lock.json`, necessário para `npm ci` reproduzível.
Consulte resultados na execução correspondente do GitHub Actions; um relatório
antigo de testes não comprova a revisão atual.

Para Android, o workflow de validação executa testes unitários e compila o APK
debug. O workflow de release verifica o certificado com `apksigner`.
Compilar não comprova instalação nem comportamento no aparelho.

No celular, teste com duas contas e conteúdo criado para teste: edição e
exclusão próprias, respostas e notificações entre contas, discussão antiga e
salvos, moderação restrita, remoção de uma resposta preservando as demais,
troca de conta e recuperação após perda de conexão. Para o vídeo, confira
login sem pop-up, exibição após entrar, fechamento e nova abertura do app.

## Documentação e histórico

- [Perfil](perfil-v0150.md)
- [Notificações dentro do app](notificacoes-v0160.md)
- [Recebimento FCM e limites](push-fcm-v0170.md)
- [Avisos em segundo plano](avisos-background-v0180.md)
- [Histórico de versões iniciais](../CHANGELOG.md)

Os guias de aplicação dos patches 0.5–0.12, o script de criação inicial e o
relatório estático de testes foram retirados por estarem superados. Seus
conteúdos completos continuam no
[histórico anterior à limpeza](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/tree/22824fadd4c988ac24616e7bf7411823f3e3e61c).
Os demais documentos de versões descrevem o escopo da época; não são fonte
da versão integrada nem prova de implantação em produção.
