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
- Para conta ainda não verificada, consultar `app_config/email_verification` por **REST Firestore usando OAuth de serviço do Worker**, após validar o ID token do membro pelo Identity Toolkit. Nunca usar campos editáveis do perfil nem dispensar essa validação de identidade. `enabled=true` e `version=2026-11-v1` impedem a operação.
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

## Correção de homologação: Worker HTTP 503 com conta não verificada (PR #145)

Em 05/11/2026, com a política **MISSING**, o teste real no Termux mostrou que a conta QA **não verificada** recebia 404 no GET de post inexistente (Firestore), mas **503** em ambos os Workers. A conta QA **verificada** recebeu 404, 403 e 202 nos três serviços, respectivamente. Isso isolou a falha ao ramo de leitura administrativa da política dos Workers, sem comprovar que ela era a única origem possível do erro.

O código dos dois Workers foi alterado para reutilizar **o OAuth da service account que já existe nesses Workers**, exclusivamente para consultar a política. O ID token do usuário continua sendo validado pelo Identity Toolkit antes de qualquer privilégio. Se OAuth, Firestore, rede, corpo ou autorização falhar, o Worker permanece em **fail-closed 503**; se o documento estiver ausente, preserva a compatibilidade do rollout; se a política estiver ativa, nega o acesso ao usuário não confirmado.

Testes unitários simulam Auth, OAuth administrativo e Firestore REST; a autenticação do usuário não pode ser substituída pelo token de serviço. A correção NÃO deve ser considerada homologada apenas porque o CI passou. É obrigatória uma nova versão dos Workers e repetição dos dois testes reais com `--policy=MISSING`, antes de qualquer ativação administrativa. Não liberar APK Release.


## Diagnóstico seguro do 503 após atualização de Workers

Em 05/11/2026, a conta QA **não verificada** continuou recebendo HTTP 503 em avatar e Push/Guardião, mesmo após a correção OAuth da PR #145. O Firebase Auth confirmou `emailVerified:false`; Firestore retornou 404 para post inexistente; a conta QA verificada passou 404/403/202. **A causa do 503 ainda não está comprovada.**

A PR de diagnóstico adiciona, **apenas para o endpoint do Guardião** e sob solicitação explícita com `X-Atrio-QA-Diagnostic: 1`, um código fechado e limitado para o caso de erro após autenticação. Ex.: `policy_service_oauth_failed`, `policy_fetch_runtime_cache`, `policy_fetch_failed`, `policy_http_403`, `policy_http_503`, `policy_invalid_response`. O HTTP permanece 503 e nenhuma operação é liberada. Sem o cabeçalho, continua aparecendo somente `status: unavailable`.

O Termux lê e apresenta exclusivamente esse código como `pushDiagnostic`; não imprime token, e-mail, senha, resposta remota ou nome de conta. Códigos desconhecidos viram `unclassified_503`. Isso é instrumento **temporário de diagnóstico**, não uma autorização para abrir a comunidade.

Após atualizar a cópia de auditoria, repetir **somente** a conta QA não verificada em política MISSING, sem ativar nenhuma flag:

```sh
cd ~/atrio-auditoria
git pull --ff-only origin main
node scripts/termux-real-email-auth-smoke.mjs --policy=MISSING --user=unverified
```

O valor `pushDiagnostic`, se exibido, identifica a próxima correção a realizar no GitHub. Não habilitar a política, não publicar APK Release e não alterar o backup enquanto o resultado for `allPassed:false`.

## Compatibilidade do fetch com Cloudflare Workers (05/11/2026)

O erro real de QA `pushDiagnostic: policy_fetch_failed`, com política `MISSING` e conta não verificada, foi rastreado a uma incompatibilidade no código compartilhado: `redirect: 'error'` não é implementado pelo runtime Cloudflare Workers e lança TypeError antes de receber HTTP. A documentação da Cloudflare orienta `redirect: 'manual'` e checagem explícita dos códigos 3xx. A correção altera **somente** esse modo de redirecionamento no helper; todas as respostas não-2xx (inclusive 3xx, 401/403/5xx) continuam falhando fechado. O modo `cache: 'no-store'` e o timeout são preservados.

Após passar CI, enviar novas versões com herança estrita de segredos/vínculos e executar novamente os testes QA reais, sem ativar a política obrigatória ou liberar APK Release.


## Homologação pré-ativação aprovada e rollout protegido (05/11/2026)

Após as correções da PR #147 e o rollout dos Workers Push **v35** e Avatares **v14**, as duas contas reais de laboratório passaram os três testes de autenticação com política **MISSING**: conta não verificada (`emailVerified:false`) e verificada (`emailVerified:true`), ambas com Firestore 404, Avatares 403 e Push/Guardião 202. Resultado em ambos: `allPassed:true`. Evidência registrada na issue #134.

A ferramenta `scripts/termux-email-policy-rollout.mjs` permite ativação controlada pelo operador no Termux **sem gcloud, sem Firebase MCP e sem gravar backups**. O comando padrão é só leitura:

```sh
cd ~/atrio-auditoria
git pull --ff-only origin main
node scripts/termux-email-policy-rollout.mjs
```

Para autorizar a ativação de fato, o operador deve confirmar antes `canActivate:true`, `rulesMatch:true` e `emailPolicyBefore:MISSING`, e estar pronto para executar imediatamente os testes de QA pós-ativação. Somente então executa a operação **que cria um documento produtivo**:

```sh
node scripts/termux-email-policy-rollout.mjs --activate --confirm=ATRIO_EMAIL_POLICY_2026-11-v1
```

Esta operação usa `POST create` na coleção `app_config`, com ID fixo `email_verification`, e falha se o documento já existir (não realiza overwrite). O hash das regras locais e publicadas deve ser `4b479daa1d4d8673c3e1e9f70a2f9d752e7df996d414aefa1397ad86661bd76e`, com o helper e as verificações presentes. Uma nova inspeção imediatamente antes da escrita impede alterações inesperadas. Depois do POST, a ferramenta exige novamente estado `ACTIVE`, data de atualização correspondente e regras coincidentes. **Se o comando falhar após a escrita, não repeti-lo automaticamente: auditar o estado real.**

Após resultado `emailPolicyAfter: ACTIVE`, **antes de qualquer Release**, executar na mesma cópia de auditoria:

```sh
node scripts/termux-email-production-readonly.mjs
node scripts/termux-real-email-auth-smoke.mjs --policy=ACTIVE --user=unverified
node scripts/termux-real-email-auth-smoke.mjs --policy=ACTIVE --user=verified
```

Esperado: `ready:true`; conta não confirmada bloqueada com Firestore 403, Avatares 401 e Push 401, sem perda de conexão ou 503; conta confirmada com Firestore 404, Avatares 400/403 e Push 202. Em seguida, completar QA manual no **Android Debug real**: tela de obrigatoriedade, reenvio do link, `reload`, token atualizado, acesso à comunidade somente após confirmar, leitura/escrita, reconexão, saída e retentativa. Nunca compartilhar e-mails, senhas, IDs de conta ou tokens.

### Retorno emergencial controlado

Se a política ativa causar bloqueios incorretos, **somente operador autorizado** pode executar:

```sh
node scripts/termux-email-policy-rollout.mjs --disable --confirm=ATRIO_EMAIL_POLICY_2026-11-v1
```

O rollback aplica `PATCH` **apenas** ao campo `enabled` usando `updateMask=enabled` e `currentDocument.updateTime` como precondição, para não sobrescrever atualização concorrente. A versão permanece `2026-11-v1`, mas `enabled:false` interrompe a obrigatoriedade. Se houver alteração concorrente, a operação falha sem forçar atualização; verificar o estado no Firebase. Rollback não altera o backup original, as regras, Workers ou APKs. Com política desligada, **Release continua proibido**. Mesmo com `ready:true`, o gate de Release só poderá ser liberado após a homologação Android e aprovação separada do Guardião.
