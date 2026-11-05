# Confirmação de e-mail obrigatória — primeiro lançamento oficial

Estado em 05/11/2026: **código de interface preparado para revisão, política produtiva NÃO ativada, nenhum APK Release autorizado**.

## O que já está pronto

- Cadastro via Firebase Authentication (e-mail e senha) envia link de verificação.
- O perfil permite reenviar o link e atualizar a sessão com `reload()` e `getIdToken(true)`.
- As regras preparadas do Firestore negam **leitura e escrita em posts, respostas, reações, curtidas, itens salvos, tópicos acompanhados, notificações e registros push** quando a exigência está ativa e o token Firebase Authentication não contém `email_verified=true`.
- O aplicativo apresenta uma tela de confirmação antes de entrar na comunidade quando a política está ativa. Ela permite reenvio, conferência e saída da conta.
- **Segurança de entrada (fail-closed):** para contas não verificadas, o aplicativo aguarda a política obtida diretamente do servidor. Cache local, carregamento inicial ou erro de leitura nunca liberam a navegação. O listener inclui mudanças de metadados (`MetadataChanges.INCLUDE`) para reconhecer a passagem cache → servidor mesmo se os dados do documento não mudarem. Em falha há opção de tentar novamente ou sair; conta com claim autêntico de e-mail confirmado pode entrar.
- A liberação após confirmar usa `reload()`, renovação do token e verificação explícita de `email_verified=true` no token atualizado.
- Os testes de Firestore e Android rodam somente com Firebase Emulator (`demo-atrio-v11`).

**Atenção:** o cliente não é fronteira de segurança; as restrições acima dependem das regras **efetivamente implantadas** no projeto de produção. Os dados privados necessários ao cadastro, ao aceite das regras e à recuperação/exclusão da conta continuam acessíveis ao titular; a exigência não equivale a bloquear o Firebase Authentication inteiro.

## Gateway obrigatório nos Workers Cloudflare (PR de segurança #134)

Os Workers de avatar e push executam operações privilegiadas que não dependem das Security Rules dos clientes. Antes de qualquer operação comunitária autenticada, ambos devem:

- Validar a sessão no endpoint oficial Firebase Identity Toolkit `accounts:lookup` e rejeitar UIDs inválidos e contas desativadas.
- Liberar imediatamente uma conta com `emailVerified === true` devolvido pelo Firebase Auth, nunca por parâmetro, perfil ou string.
- Para conta ainda não verificada, consultar `app_config/email_verification` por **REST Firestore com o próprio ID token já validado**, não com credencial de serviço. `enabled=true` e `version=2026-11-v1` impedem a operação.
- Tratar `404` da política como rollout ainda ausente; flag explicitamente desligada ou versão não ativada preservam compatibilidade. **401, 403, 429, 5xx, rede indisponível ou documento malformado NÃO autorizam a operação**.
- Permanecer sem deploy até testes offline, análise dos endpoints e homologação do ambiente produtivo. Nenhum segredo deve ser impresso, nem o Worker de QA deve acessar produção.

A política deve ser a mesma entre Android, Security Rules, Workers de avatar e push. Após a implantação, testar os dois Workers com conta real verificada e não verificada, sem permitir bypass de operação via chamada REST direta.


## Configuração administrativa — não ativar sem homologação

Documento Firestore (projeto `atrio-catolico`):
- Coleção: `app_config`
- Documento: `email_verification`
- Campo `enabled` (boolean): `true`
- Campo `version` (string): `2026-11-v1`

Somente Console Firebase ou Admin SDK autorizado pode gravar o documento; o APK não pode alterá-lo. **Configuração ausente, versão inválida ou `enabled=false` desativam a exigência no código atualmente implantado.** Confirmar sempre a versão das regras efetivamente em produção antes da ativação.

## Critérios de aceite após ativação controlada

1. Confirmar que as regras produtivas de posts/respostas contêm a validação por `request.auth.token.email_verified` e que a configuração está ativa.
2. Criar conta de QA com e-mail real não confirmado: a tela de verificação deve aparecer, sem acesso às abas da comunidade.
3. Tentativas diretas de `get`, `list`, `create`, `update` e `delete` em posts e respostas, além de criação de reações, curtidas e registros push, com token **não verificado**, devem receber `PERMISSION_DENIED` quando a política estiver ativa. Não confiar somente na interface.
4. Reenviar, receber e confirmar o e-mail; voltar ao app e tocar **Já confirmei meu e-mail**. Após renovar ID token, o acesso à comunidade e a criação de post e resposta devem funcionar.
5. Confirmar que um campo `email_verified=true` adulterado no perfil Firestore não permite burlar o bloqueio.
6. Testar logout, novo login, falha de conexão e retorno do aplicativo; **com a consulta da política indisponível, uma conta não verificada deve ver a tela de espera/erro e NÃO a comunidade**. Recuperada a conexão, o botão de nova tentativa deve retomar o fluxo normalmente.
7. O responsável confirmou que **não há contas antigas no aplicativo oficial**. Ainda assim, conferir contas de laboratório/Debug em Firebase Authentication sem excluí-las automaticamente.
8. Registrar evidências de QA sem endereço de e-mail, token, link pessoal ou credenciais. Auditar regras e atualizar a aprovação de Release apenas após comprovação.

## Rollback de emergência

O administrador pode definir `enabled=false` no documento administrativo, revertendo o portão para todos os clientes que respeitam essa versão. Isso **não substitui a avaliação de segurança** e, enquanto a obrigatoriedade estiver desativada, nenhum novo Release pode ser assinado/publicado.

## Política de Release

`.github/workflows/build-apk.yml` mantém assinatura bloqueada sem `ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED=true` **e** aprovação independente do Guardião V2. Publicação OTA também exige a aprovação de e-mail. **Não aprovar a variável antes de implementar e comprovar a obrigatoriedade em produção**. Builds Debug para QA permanecem permitidos.


## Auditoria read-only da produção (Termux / ambiente Google autorizado)

O script `scripts/email-verification-production-preflight.mjs` realiza apenas três operações **GET**: consulta a release `cloud.firestore`, lê a fonte do Ruleset publicado e consulta `app_config/email_verification` no projeto fixo `atrio-catolico`. Não faz deploy, não cria nem atualiza documentos e não acessa listas de usuários. A fonte das regras permanece somente em memória; a saída mostra hashes SHA-256, presença de verificações e o estado administrativo, jamais tokens ou dados pessoais.

Em um terminal que tenha **Node.js 22+** e **gcloud autenticado com permissões somente de leitura**, executar a partir da raiz do repositório atualizado:

```bash
ATRIO_READONLY_OAUTH_TOKEN="$(gcloud auth print-access-token)" \
  node scripts/email-verification-production-preflight.mjs
```

O token OAuth deve permanecer exclusivamente no terminal do operador; **não compartilhar credenciais, JSON de contas de serviço nem o token no chat ou em Issues do GitHub**. O acesso precisa ler a política Firestore e as releases/rulesets do Firebase Rules. Se a conta não tiver autorização, o auditor retorna `atrio_preflight_permission_denied` e não altera nada.

`ready: true` é resultado somente das inspeções de configuração: exige identidade do projeto, regras publicadas exatamente iguais às do arquivo `firestore.rules` atual, função de proteção presente, verificação de claim e política `ACTIVE`. Se aparecer `ready: false`, **não aprovar Release**. Mesmo com `ready: true`, continuam obrigatórios os testes reais com Firebase Auth, Android e Workers após um rollout autorizado. A igualdade de regras é deliberadamente estrita: arquivos divergentes precisam de revisão, jamais aprovação automática.

O comando local de testes unitários, sem rede nem acesso à produção, é:

```bash
node --test scripts/email-verification-production-preflight.test.mjs
```


## Homologação autenticada com contas QA reais — Termux

Após a implantação das Firestore Rules e dos Workers, mas **antes** de ativar `app_config/email_verification`, preparar duas contas **existentes** de laboratório no aplicativo Debug: uma com endereço não confirmado, outra com endereço confirmado. Não usar contas pessoais de terceiros nem a conta administrativa. A ferramenta não cria contas.

O programa `scripts/termux-real-email-auth-smoke.mjs` utiliza o Firebase CLI já autenticado no Termux para descobrir **em memória** a API key do app Android `br.com.atriocatolico` no projeto fixo `atrio-catolico`. No terminal, pede o e-mail e a senha de **uma conta por execução**, ambos sem eco. Não imprimir nem copiar as credenciais para a conversa, GitHub Issues ou arquivos.

Na pasta de trabalho `~/atrio-auditoria` (não no backup original), após integrar o código:

```sh
cd ~/atrio-auditoria
git pull --ff-only origin main
node scripts/termux-real-email-auth-smoke.mjs --policy=MISSING --user=unverified
node scripts/termux-real-email-auth-smoke.mjs --policy=MISSING --user=verified
```

Essas duas chamadas produzem apenas códigos HTTP e `pass: true/false` para consultas seguras: Firebase Authentication `accounts:lookup`, leitura da política, leitura de **post aleatório inexistente**, validação de autorização da prévia de avatar sem argumentos e evento de moderação para **post aleatório inexistente**. O último retorna `ignored` sem gravar denúncia, fila, notificação ou alterar qualquer publicação quando o post não existe. A autenticação normal pode atualizar metadados de último acesso no Firebase Authentication. Nenhum arquivo, backup ou documento Firestore é criado pelo teste.

**Critérios da fase anterior à ativação (MISSING):** para as duas contas, o post inexistente retorna 404, a prévia de avatar retorna 400 ou 403 (acesso negado à função administrativa ou argumento ausente), e o evento de post inexistente retorna 202 (ignorado). A conta não confirmada é identificada como `emailVerified:false` pelo Firebase Auth. Isso comprova comunicação autenticada, não o bloqueio obrigatório.

Após a **ativação administrativa controlada** da política (procedimento separado, ainda não realizado), repetir com as mesmas contas:

```sh
node scripts/termux-real-email-auth-smoke.mjs --policy=ACTIVE --user=unverified
node scripts/termux-real-email-auth-smoke.mjs --policy=ACTIVE --user=verified
```

**Critérios com política ACTIVE:** não confirmada recebe **403** em Firestore, **401** no avatar e **401** no Guardião/push. Confirmada recebe **404** no post inexistente, **400 ou 403** na prévia administrativa e **202** para post inexistente no Guardião. O script interrompe os testes se a política não estiver exatamente no estado indicado, se o Firebase Auth relatar um estado de confirmação diferente ou se alguma autorização responder fora dos resultados esperados.

Não executar a fase ACTIVE antes de estabelecer a política pelo procedimento apropriado. O teste não valida a UI do Android nem substitui a confirmação do link, logout, retry/offline, abertura de discussões e testes instrumentados. Mesmo com testes PASS, assinatura Release depende de homologação completa e aprovação formal.

Se a sessão Firebase CLI não puder ler a configuração Android ou a API key estiver bloqueada para uso no Termux, **não copiar chaves nem desativar restrições para forçar o teste**: interromper e adaptar o processo. As duas contas devem ser exclusivamente de QA e não compartilhar senha com o assistente.
