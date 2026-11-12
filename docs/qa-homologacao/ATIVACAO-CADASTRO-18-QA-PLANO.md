# Ativação do cadastro 18+ — plano de preparação e reversão (QA somente)

**Estado:** proposta de pré-ativação sem publicação, branch draft [#232](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/232). **Tarefa 3/5** (40% ao iniciar). Não altera Firebase/Cloudflare, usuários, `main`, APK instalado, regras oficiais, IAM ou backups.

## 1. Base observada e riscos de mudança simultânea

A leitura autenticada no Termux do fundador em 11/11/2026, `2026-11-11T01:16:22.664Z`, confirmou o projeto `atrio-catolico-qa-geral`, o pacote `br.com.atriocatolico.chatqa` e Firestore QA em **deny-all**. Hash remoto observado: `cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b`. Essa é uma **fotografia histórica**, não garantia de que a publicação atual permaneça igual em data futura.

O arquivo `firebase/qa-general/qa-deny-all-reference.rules` é uma política *equivalente* de negação total, com testes negativos; **NÃO é backup byte a byte** do Ruleset remoto. Para uma reversão à mesma release, antes de publicar seria necessário registrar (sem token) também o **nome/ID exato do Ruleset atual**, comprovar que continua acessível e dispor de IAM apropriado. Um hash, sozinho, não restaura uma release.

## 2. Candidato de regras e relatório offline

`node scripts/chat-qa-activation-preflight.mjs`

Esse comando é **somente local**, lê `firestore.rules` versionado, os fragmentos QA e a referência de negação, compõe o candidato com `renderClosedQaParity`, valida as âncoras de elegibilidade, e-mail, destinatários, grupos e `deny-all` residual; emite hashes e o quadro de pendências. Ele **não lê nem modifica** Firebase real; não gera configuração de deploy, não solicita credenciais e sempre indica `ready_for_deploy=false`.

Para testes de regressão na CI: `node --test scripts/chat-qa-activation-preflight.test.mjs`; a suíte do Firebase Emulator valida também que a referência de negação bloqueia leitura, criação, edição e exclusão.

## 3. Ordem planejada de ativação — somente após aprovação específica

1. **GO/NO-GO humano:** aprovar por escrito o escopo de testes com contas fictícias fechadas, moderação, privacidade, retenção e as decisões aplicáveis na [issue #200](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/200). **Autodeclaração não verifica a idade**, portanto não liberar testes abertos ou prometer conformidade automática.
2. **Auditoria IAM e segregação:** conferir a conta operacional com permissão restrita a QA, impossibilidade de atingir `atrio-catolico` e produção, projeto, bancos, regras e App Android corretos. Não obter, colar ou versionar credenciais.
3. **Estado anterior e rollback:** realizar novo GET somente leitura do QA, registrar hash **e ID exato do Ruleset** ativo e validar reversão manual em plano aprovado, incluindo permissões/tempo de resposta. Divergência com o snapshot exige nova revisão, sem tentar publicar.
4. **Matriz de segurança:** aprovar fragmentos e teste emulador para acesso ausente, menor declarado, e-mail não confirmado, UID alheio, expiração, revogação, políticas desligadas, abuso de grupos e denúncia. Grupos e notificações continuam **OFF**; não usar o Worker oficial ou sua configuração. O Worker QA de PR #231 ainda possui contrato etário diferente (`eligible` versus `declared_18_plus`).
5. **Preparar contas sintéticas e operação reversível:** documentação das contas e resultados esperados sem dados reais, recuperação para falha assíncrona `.set()`, telemetria sem nascimento, plano de atendimento/moderação e rejeição de solicitações externas; conferir custos/cotas antes de qualquer chamada de escrita.
6. **Aprovação separada e publicação QA:** somente após sua autorização explícita e GO técnico, realizar publicação estritamente identificada e auditada em **QA**, sem publicar `firestore.rules` da produção e sem alterar `main`. Não há script de deploy neste pacote de preparação.
7. **Pós-operação/volta ao estado fechado:** repetir consultas remotas e testes negativos. Em falha ou incidente, interromper os testes e executar o procedimento de reversão **aprovado**, restaurando o Ruleset previamente identificado ou a política deny-all verificada e reinspecionando o resultado; nunca afirmar rollback por tentativa sem confirmação remota.

## 4. Decisões que continuam abertas

- **DMs vs. grupos:** `chatGroupAccess/eligibility` é independente de `chatAgeEligibility/current`, então marcar 18+ não aprova automaticamente grupos. Manter grupos desativados até decisão e aprovação.
- **Mensagens push:** o Worker QA de outra PR ainda espera `eligible`/versão antiga, logo manter FCM e entrega externa desativados; integração futura exige nova auditoria e testes.
- **Cadastro:** `set()` de autodeclaração pode falhar depois que a conta foi criada. A UI precisa oferecer recuperação antes de um teste real que prometa acesso automático.
- **Governança:** a issue #200 permanece aberta; sem política aprovada, nenhuma liberação para usuários externos.
- **Reversão:** referência deny-all não é cópia da release e o ID/controle IAM exigem consulta e revisão humana.

**Não executar** `firebase deploy`, `wrangler deploy`, `--apply`, mesclar PRs ou copiar dados de produção nesta etapa. O progresso geral do QA permanece **29% (2/7)**, independente do avanço desta tarefa.

## Proteção adicional contra deriva do código

O pré-flight faz pin dos hashes **Git blob SHA-1** dos fragmentos
`firebase/atrio-conversas-v1.rules.fragment` e
`firebase/atrio-grupos-v1.rules.fragment` revisados nesta branch
(`1a5a37c3e69a4a08839adf9f294e7aa0ea081113` e
`400b09a061a98bb606e95fa68c6becee2202629b`, respectivamente).
Um desvio interrompe a preparação, inclusive se trocar um gate por `true`.
O hash Git é um controle de versão do código, **não** atesta segurança
criptográfica da política ou aprovação jurídica.

A validação da referência de reversão compara o conteúdo **normalizado**
sem espaços e comentários. A primeira versão do pré-flight apresentou
falha de comparação por compactação assimétrica; foi corrigida e deve
ser confirmada na CI do novo SHA. Esse bug não alterou serviços remotos.

## Identificador de Ruleset para reversão planejada (capturado no QA real)

O relatório `scripts/termux-firebase-qa-audit-readonly.mjs` passou a emitir
`remote_ruleset_name`: um identificador público de versão **do QA**,
validado por projeto e lido junto com o mesmo hash em quatro GETs estritamente
read-only. Sem esse identificador, o hash do snapshot anterior não permite
identificar a release que deverá ser restaurada manualmente. Não existe
comando de deploy ou rollback automático nesta PR.

Quando o operador atualizar o clone QA já configurado (`git pull --ff-only`
dentro de `~/atrio-workspaces/qa-cadastro`) e executar novamente o comando
read-only, conferir simultaneamente:
`status=QA_REAL_DENY_ALL_CONFIRMED`, `remote_rules_deny_all=true`,
`rules_sha256` do QA, e o `remote_ruleset_name` cujo prefixo **obrigatório**
é `projects/atrio-catolico-qa-geral/rulesets/`.

**Não confundir** obter o ID com autorização para restaurar/publicar: o
procedimento de mudança continua bloqueado pela issue #200, revisão IAM e
aprovação específica, com grupos e FCM mantidos desligados.

## Evidência de Ruleset remoto fornecida pelo operador — etapa 3/5

**Registrada após nova execução autenticada, exclusivamente leitura, no Termux.**
A captura enviada pelo fundador comprova a saída apresentada pelo
`scripts/termux-firebase-qa-audit-readonly.mjs`; o agente não executou
consultas autenticadas ao Firebase em seu próprio ambiente.

- Projeto: `atrio-catolico-qa-geral`.
- Pacote: `br.com.atriocatolico.chatqa`.
- `status=QA_REAL_DENY_ALL_CONFIRMED`.
- `remote_project_and_app_verified=true`, `remote_firestore_rules_verified=true`.
- `remote_rules_deny_all=true`, `ready_for_activation=false`.
- `rules_sha256=cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b` (igual ao snapshot anterior).
- `remote_ruleset_name=projects/atrio-catolico-qa-geral/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc`.
- Data/hora UTC exibida: `2026-11-11T01:40:25.461Z`.
- `production_contacted=false`, `changes_performed=false`.

**Resultado:** concluída a preparação documental e offline da etapa 3,
com identificação da versão do Ruleset QA ainda fechado e referência de
retorno a `deny-all`. A barra desta tarefa passa a **60% (3/5)**.
Isso **NÃO significa** ter executado reversão, testado permissões IAM
para publicar, feito backup byte-a-byte, obtido autorização de deploy ou
aberto chat/grupos/notificações. Antes de qualquer etapa de ativação,
validar IAM e eventual retenção do Ruleset histórico, rever a issue #200,
confirmar o estado remoto imediatamente antes da publicação e obter
autorização específica do fundador. Em caso de revisão de segurança
não aprovada, manter o QA deny-all. QA geral continua **29% (2/7, NO_GO)**.

## Etapa 4 — pré-verificação de permissões e bloqueio de onboarding (sem deploy)

**Achado crítico de integração:** o app Android Chat QA precisa ler
`app_config/email_verification` e gravar
`users/{uid}/private/account`, `community_consents/{uid}` e
`profiles/{uid}` no cadastro. As Rules alternativas atuais são
restritivas e **não autorizam essas rotas**. Testes de regressão no Firebase
Emulator comprovam essa negativa deliberada. Logo, **não basta publicar
as Rules candidatas do chat**: a experiência em celular ainda não
completará o onboarding/confirmará a política. Antes de publicar, é
necessário definir e testar um esquema QA mínimo dessas rotas, com
propriedade por UID, campos exatos, e-mail obrigatório e controle
administrativo. Não abrir permissões globais nem usar Rules de produção.

**Auditoria IAM não mutante, opcional no Termux:** após a revalidação do
projeto, pacote, versão remota e `deny-all`, o novo comando
`node scripts/termux-firebase-qa-iam-readonly.mjs` consulta
**apenas** a API de teste de permissões para
`atrio-catolico-qa-geral`. O Google exige o método HTTP
`POST ...:testIamPermissions`, mas essa operação *não altera
permissões*. Não confundir com `POST ...:setIamPolicy`.
O comando testa direitos de leitura e
`firebaserules.rulesets.create`/`firebaserules.releases.update`
no **projeto QA**, devolvendo apenas booleanos sem token, membros
ou papéis. Mesmo com `may_have_publish_permissions_in_qa=true`,
devolve sempre `ready_for_activation=false`: teste IAM não autoriza
deploy, não prova que o usuário não tenha acesso à produção, nem
substitui a revisão da política #200.

Referências oficiais:
- https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/testIamPermissions
- https://firebase.google.com/docs/projects/iam/permissions

A consulta remota via Termux **ainda não foi executada** nesta rodada.
A CI exercita apenas fixtures e garante que o método é restrito a QA.
A revisão do processo segue em **NO_GO** e a barra da tarefa em
**60% (3/5)**, até que as dependências sejam resolvidas e a
autorização específica de ativação tenha sido concedida.

## Correção candidata das rotas de onboarding (sem deploy)

Após confirmar via `testIamPermissions` as cinco permissões **no QA**
(`may_have_publish_permissions_in_qa=true`, saída do Termux fornecida
pelo operador, **sem prova de isolamento da produção**), o código
candidato passou a conter **exclusivamente no gerador alternativo QA**
as permissões mínimas do cadastro V2. A fonte nova é
`firebase/qa-general/registration-onboarding-rules.mjs`.

- `app_config/email_verification` e `app_config/community_rules`:
  leitura (`get`) para autenticados; nenhuma escrita, listagem ou
  exclusão permitida ao cliente. As configurações precisam ser
  preexistentes e aprovadas administrativamente antes de um teste real.
- `users/{uid}/private/account`: criação pelo próprio UID, com
  `pending_email`, `profileVersion=2`, flags de notificação falsas e
  timestamp do servidor. Transição para `complete` somente após
  `email_verified`, sem campos inesperados.
- `profiles/{uid}`: criação do nome público por UID com campos
  estritos e atualização só após e-mail validado. Leitura somente
  do próprio UID; não existe listagem/consulta de outros perfis.
- `community_consents/{uid}`: aceite por UID com versão exata e
  timestamp de servidor, exclusão pelo próprio UID.
- `users/{uid}/private/preferences`: dados de fé/paróquia privados,
  campos limitados e aceite específico; criação/edição somente com
  e-mail verificado; o próprio UID pode apagá-los.

Os cenários positivos e negativos foram acrescentados ao Firebase
Emulator e são disparados pela CI do draft #232. **Esse novo código
não modifica `firebase/firestore.rules` nem o Ruleset remoto QA.**
O cadastro real ainda exige a confirmação e aprovação da configuração
`app_config/email_verification` com `enabled=true` e
`version='2026-11-v1'`; o candidato de regras *não cria* esse
documento. Sem ele, o cliente pode considerar a política opcional
para contas antigas; por isso **não há autorização para publicar**.

Também segue pendente recuperação amigável da gravação assíncrona
da autodeclaração, validação integrada do onboarding no Android,
moderação e privacidade (issue #200). Grupos e Worker/FCM continuam
bloqueados. Progresso da tarefa ainda **60%** até preencher todas
as condições de GO e obter autorização específica.

## Candidato de recuperação explícita da declaração no chat (somente QA)

**Correção de UX do bloqueio após o cadastro assíncrono:** se a conta for
criada e a escrita posterior de `chatAgeEligibility/current` falhar, ao
abrir "Conversas" no APK Chat QA o cliente consulta esse documento com
`Source.SERVER`. Se estiver ausente, apresenta **somente no Chat QA**
um painel opcional para informar novamente a data DD/MM/AAAA, calcular
idade local, marcar a confirmação expressa 18+ e tentar **uma criação
pelo próprio UID**, sem guardar nem transmitir a data de nascimento.

- **Sem registro:** solicitação voluntária de novo aceite; conta e outras
  áreas não são bloqueadas. A cada alteração de data, o checkbox volta
  a desmarcado. A escrita é sujeita às mesmas Rules create-only.
- **Com registro válido:** mostra a conversa sem reabrir declaração;
  as Rules seguem como autoridade (e-mail, política e permissões).
- **Vencido, revogado, esquema alterado:** mantém chat bloqueado,
  sem botão de sobrescrever ou "renovar" de forma insegura.
- **Erro de leitura/autenticação:** não habilita chat; oferece nova consulta
  autenticada. Após escrita, reconsulta sempre o servidor, não o cache.
- **Escopo:** APK com `applicationId=br.com.atriocatolico.chatqa`, nenhum
  impacto no fluxo de produção. Testes JUnit validam leitura lógica
  conservadora de status/versão/validade. Ainda falta ensaio manual
  integrado com dois aparelhos usando um QA real e Rules aprovadas.

**Limite não resolvido:** a edição de Rules QA e o teste não significam
que a criação de declaração tenha sido recebida pelo servidor no fluxo
de cadastro de um aparelho real. A tela de recuperação mitiga esse caso
de falha sem ignorar a política e não comprova identidade/idade real.

## Fase administrativa preparada OFFLINE — configuração estagiada, sem deploy

A ferramenta `firebase/qa-general/admin-config-preflight.mjs` modela os
quatro documentos **QA apenas**, compatíveis com as versões realmente
exigidas pelo Android e pelas Rules de grupos. **Não** é leitura do
Firestore remoto nem script para escrever documentos.

| Caminho | Modelo sintético para preparação | Situação |
| --- | --- | --- |
| `app_config/email_verification` | `enabled=true, version=2026-11-v1` | Requer publicação separada e autorizada |
| `app_config/community_rules` | `enabled=true, version=2026-11-v1` | Requer aprovação do texto da comunidade |
| `app_config/conversations` | `enabled=false, minorPolicyApproved=false, safetyReviewVersion=pending-review`, edição e exclusão desligadas, janelas zero | Chat deliberadamente fechado |
| `app_config/chat_groups` | `enabled=false, minorPolicyApproved=false, version=2026-11-groups-v1` | Grupos deliberadamente fechados |

**Regra de segurança:** o pré-flight aceita **somente** o formato
estagiado acima, rejeita qualquer tentativa de `enabled=true` em
conversas/grupos, qualquer `minorPolicyApproved=true`, versões
impróprias ou campos adicionais e retorna sempre
`ready_for_deploy=false`, `changes_performed=false`.
O único cenário com chat aberto é um **fixture sintético exclusivo do
Firebase Emulator** usado para provar a elegibilidade quando as outras
políticas forem autorizadas. A configuração não está publicada no QA.

Comando de inspeção local sem rede:
`node firebase/qa-general/admin-config-preflight.mjs`.
Testes unitários confirmam versão Android/código e rejeição de adulteração.
Testes de Firestore Emulator confirmam que as políticas podem ser lidas
apenas por conta autenticada, que o usuário não pode alterar configurações
e que a configuração estagiada **não permite chat nem grupos**.

**Próximo GO condicionado:** aprovação da política aplicável (#200),
confirmação documental de regras e IAM, autorização específica do
fundador, e publicação estritamente QA com plano de reversão. A
ativação do chat é **uma segunda mudança**, jamais combinada com a
configuração inicial de e-mail/comunidade. Não ativar Worker/FCM.

A barra da ativação continua **60% (3/5)** e o QA geral continua
**29% (2/7)** enquanto o Firebase QA real permanecer deny-all.

## Inspeção de documentos administrativos publicados no Firebase QA real

**Próxima checagem read-only:** o plano e os testes de políticas estão
aprovados **somente como modelos offline**, sem evidência de quais
documentos `app_config` existem no projeto real. Foi criado
`scripts/termux-firebase-qa-admin-config-readonly.mjs` para ler apenas
as quatro configurações aprovadas, usando OAuth da sessão Firebase
CLI do operador no Termux.

O script:
1. Revalida o projeto QA e pacote Android, o estado deny-all, o hash
   `cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b`
   e o identificador do Ruleset remoto registrado na última auditoria,
   com até **quatro GETs** de identidade/Rules (falha fechado ao mudar).
2. Só então realiza até **quatro GETs Firestore** limitados aos documentos
   `app_config/email_verification`, `app_config/community_rules`,
   `app_config/conversations`, `app_config/chat_groups`, com
   `mask.fieldPaths` para pedir apenas os campos do modelo estagiado.
   Usa **OAuth Google + IAM**; não depende do acesso liberado pelas
   regras client-side deny-all, não aciona SDK Admin para escrever.
3. Se um documento não existir (HTTP 404), marca `MISSING`. Se existir,
   compara **somente os campos mascarados** com o modelo estagiado e
   imprime apenas estados, booleanos e **nomes de campos divergentes**.
   Não exibe tokens, outros campos, nomes de pessoas, dados religiosos
   nem respostas brutas; erros 403 e de rede **não viram MISSING**.
4. Retorna `ready_for_activation=false` e
   `ready_for_deploy=false` independentemente do resultado. Se
   chat/grupo tiver sinal de habilitação inesperada, alerta e sai com
   código 2. A inspeção não demonstra ausência de campos adicionais,
   não cria o documento faltante, não altera políticas nem comprova
   conformidade de conteúdo. É um retrato de leitura, não um backup.

**Comando após CI aprovada, no workspace QA do Termux:**
```sh
cd "$HOME/atrio-workspaces/qa-cadastro" &&
git pull --ff-only &&
node scripts/termux-firebase-qa-admin-config-readonly.mjs
```

**Por que esta consulta é diferente:** o Firestore real continua deny-all
para clientes, mas o OAuth do Firebase CLI pode autorizar leitura
administrativa pelo IAM; esta consulta não usa Firebase Authentication de
usuários. Não presume que o login tenha direito de ler documentos:
403 deve ser reportado sem novas permissões ou credenciais. Serão
consultados apenas quatro documentos e nenhum dado de usuários. O Google
documenta a API REST de leitura GET e `mask.fieldPaths`:
https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/get

**Sem resultado remoto autenticado nesta revisão:** a PR e a CI
apenas simulam respostas. A barra de ativação permanece **60% (3/5)**,
o QA geral **29% (2/7)**; a publicação exige autorização específica,
revisão da issue #200 e testes reais posteriores.


## Evidência remota COMPLETA de app_config fornecida pelo operador (11/11/2026)

O fundador executou `scripts/termux-firebase-qa-admin-config-readonly.mjs`
no Termux autenticado, no workspace segregado
`~/atrio-workspaces/qa-cadastro`, e enviou três capturas sucessivas
do resumo sanitizado, incluindo **cabeçalho e as quatro entradas**.
Esta é **evidência fornecida pelo operador**; não é uma consulta
autenticada que o assistente efetuou diretamente.

- `status=QA_ADMIN_CONFIG_SNAPSHOT_READ_ONLY`
- `project=atrio-catolico-qa-geral`
- `android_package=br.com.atriocatolico.chatqa`
- `rules_sha256=cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b`
- `ruleset_name=projects/atrio-catolico-qa-geral/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc`
- `queried_documents=4`, `existing_documents=0`,
  `missing_documents=4`.
- `app_config/email_verification`: `MISSING`, `present=false`
- `app_config/community_rules`: `MISSING`, `present=false`
- `app_config/conversations`: `MISSING`, `present=false`
- `app_config/chat_groups`: `MISSING`, `present=false`
- `all_four_staged_fields_match=false`
- `chat_and_groups_observed_closed=true`
- `remote_rules_deny_all=true`
- `ready_for_activation=false`, `ready_for_deploy=false`
- `changes_performed=false`, `production_contacted=false`
- `method=FOUR_QA_IDENTITY_RULES_GET_PLUS_FOUR_FIRESTORE_MASKED_GET`
- `audited_at=2026-11-11T03:33:17.816Z`

**Interpretação:** a consulta confirmou que não há nenhum dos quatro
documentos de configuração administrativa no Firebase QA naquele
instante. O fato de chat e grupos estarem fechados decorre de
**ausência da configuração e Rules deny-all**, e não de um documento
publicado com `enabled=false`. Não equiparar `MISSING` a
`PRESENT_STAGED_FIELDS_MATCH`.

**Próximas dependências:** revisar e aprovar as políticas efetivas de
verificação de e-mail e aceitação de regras da comunidade; revisar
privacidade, moderação, proteção de menores e retenção da issue #200.
Preparar eventual criação controlada dos quatro documentos com
`conversations.enabled=false`, `chat_groups.enabled=false`,
`minorPolicyApproved=false`, sem abrir Firestore nem publicar no
ambiente real sem uma autorização futura e específica do fundador.
Após a autorização e publicação, comparar o estado remoto novamente e
testar o cadastro em dispositivos. Grupo e FCM permanecem fora de escopo
de ativação inicial.

**Estado preservado:** 60% (3 de 5 etapas) da ativação específica,
29% (2 de 7) do QA geral, NO_GO. Nenhum deploy/rollback, nenhuma
escrita no Firestore real, em `main` ou nos backups nesta rodada.

## Manifesto OFFLINE de criação inicial de app_config QA (não executável)

A consulta remota autenticada apresentada pelo operador às
`2026-11-11T03:33:17.816Z` identificou os quatro documentos de
administração como ausentes. Foi preparado
`scripts/chat-qa-admin-initial-create-plan.mjs`, um manifesto de
**intenções de criação exclusiva**, sem SDK, rede, token, deploy,
restauração automática ou opção de aplicar a operação.

```sh
node scripts/chat-qa-admin-initial-create-plan.mjs
```

O manifesto só aceita a evidência histórica identificada (projeto
`atrio-catolico-qa-geral`, pacote `br.com.atriocatolico.chatqa`,
hash e Ruleset QA capturados, quatro entradas `MISSING`), verifica o
contrato estrito `STAGED_QA_DOCS` e mostra os **quatro documentos
propostos** com campos tipados na representação REST do Firestore.
Não acrescenta outros caminhos, usuários, credenciais ou dados
pessoais; hashes SHA-256 sinalizam o formato proposto.

A **operação FUTURA**, somente se vier a ser autorizada de forma
específica, deverá ser *create-only* para cada document ID:
`createDocument` (se já existir, **abortar; nunca update/upsert**),
com verificação de existência e hash/Ruleset imediatamente antes,
seguida de releitura autorizada depois; resultados parciais devem
parar e passar por reconciliação humana. O manifesto presente **não
possui nenhuma função de envio, POST ou execução**. Nenhuma credencial
deve ser incluída nos registros de auditoria.

A configuração preparada mantém `email_verification.enabled=true`
e `community_rules.enabled=true` **apenas como proposta não publicada**;
as regras efetivas de comunidade e o texto legal/consentimento requerem
decisão da #200. Para conversas e grupos,
`enabled=false`, `minorPolicyApproved=false`; não há envio de
notificações, nem abertura de chat/FCM.

**Barreiras para GO:** deliberação e revisão #200; autorização
específica para quatro criações QA; comprovação de isolamento de
privilégios; GET remoto contemporâneo; identificação do RuleSet
para reversão; testes em aparelhos. **Não pedir comando de escrita
ao operador neste marco de pré-preparação.** O QA continua deny-all
e o progresso da tarefa segue **60% (3/5)**; QA geral **29% (2/7)**.

## Integração do manifesto de criação ao pré-flight geral

A rotina `scripts/chat-qa-activation-preflight.mjs` passa a testar
também o manifesto `prepareQaAdminCreatePlan`, exigindo:
(1) a evidência histórica dos **quatro documentos ausentes**,
(2) os quatro caminhos `app_config` esperados,
(3) `overwrite_allowed=false`,
(4) `chat_enabled=false` e `groups_enabled=false`,
(5) `ready_for_deploy=false` e `changes_performed=false`.

Qualquer divergência no snapshot, versão ou caminho impede o pré-flight
de prosseguir. Isso não garante ausência atual no Firebase remoto: a
última leitura do operador é histórica. Nenhum código de escrita,
deploy ou atualização de RuleSet foi acrescentado à branch.

## Revisão das políticas no cadastro (sem publicação)

A auditoria do fluxo de cadastro identificou que as condições de uso e a
privacidade são explicitamente **prévias**, sem versão legal completa e
sem prazo de retenção aprovado. Na variante Chat QA, os checkboxes de
termos e privacidade **não bloqueiam a criação da conta**, embora o
aceite das Regras da Comunidade seja exigido. A documentação completa
foi registrada em
`docs/qa-homologacao/CADASTRO-REGRAS-PRIVACIDADE-REVISAO-QA.md`.

**Defesa adicional Chat QA:** enquanto
`app_config/community_rules` estiver ausente, inválido, desativado,
carregado apenas do cache ou falhar, a UI de comunidade passa a
**bloquear a entrada** em vez de ignorar silenciosamente o portão.
Produção mantém o rollout original. A autorização real permanece
sob responsabilidade das Rules Firestore. Testes Kotlin unitários
garantem as cinco condições negativas.

O texto atual das Regras da Comunidade é um rascunho funcional a ser
revisado; a existência do texto e de testes **não aprova** prazos de
moderação, privacidade ou retenção. Não publicar documentos estagiados
sem revisão humana #200 e autorização específica QA. Progressos
permanecem 60% na tarefa e 29% no QA geral.

## Aceite confirmado somente pelo servidor — QA

Adicionada exigência no Chat QA de que o consentimento individual
`community_consents/{uid}` seja confirmado no Firestore antes de
permitir a entrada: versão válida e sem cache, escrita pendente ou
erro. Combina-se com o gate administrativo de Regras confirmado
no servidor. A produção permanece inalterada e o QA real segue
em deny-all. JUnit cobre estados negativos; esta alteração não
supre revisão jurídico-operacional da issue #200 nem autoriza deploy.

## Cadastro normal dos participantes dos testes fechados — decisão do fundador (11/11/2026)

**Decidido:** os participantes do grupo de testes fechado **criam suas contas normalmente pelo formulário de cadastro já existente no Átrio Católico**. Não haverá, como requisito adicional desta fase, lista de UIDs autorizados, convite técnico, provisionamento administrativo de contas ou aprovação manual de cada cadastro. **Não bloquear a etapa 4 esperando essa lista.**

O protótipo opcional `qaClosedBetaTester` / `qa_closed_testers`, estudado em commits anteriores da PR #232, foi **retirado do candidato e da suíte de CI** por não corresponder à forma de ingresso adotada pelo fundador. A decisão não afrouxa os controles que já existem para cadastro, e-mail, regras da comunidade, autodeclaração 18+ provisória e portas administrativas fechadas de chat/grupos; também não significa que o aplicativo já conte com bloqueio técnico de cadastro por convite, nem que o Firebase QA esteja liberado.

**O grupo fechado é uma condição operacional declarada pelo fundador**, não uma comprovação automática de acesso exclusivamente autorizado. Se o escopo de testes ou o público mudar, os riscos podem ser reavaliados. A ativação de chats e grupos ainda depende da conclusão do QA real e das autorizações específicas já previstas na issue #200. Nenhum dado de participante real foi consultado, publicado ou alterado.

## Limite confirmado — configuração QA não habilita o mural da comunidade (11/11/2026)

**Auditoria cruzada do aplicativo e Rules candidatas:** o cadastro de
participantes mantém o formulário normal, cujo código usa
`FirebaseAuth.createUserWithEmailAndPassword`. Após a autenticação,
o Android depende de `users/{uid}/private/account`, `profiles/{uid}`,
`community_consents/{uid}` e dos dois `app_config` de e-mail e
regras da comunidade; essas rotas fazem parte do **candidato de
cadastro/Chat QA** e têm testes com fixtures.

Entretanto, a interface `OnlineCommunity` consulta
`posts` e `posts/{postId}/replies`. **O candidato da PR #232 não
concede acesso a essas rotas**, que permanecem negadas pelo fallback
`match /{document=**} { allow read, write: if false; }`.
Isso é um limite deliberadamente restritivo: não equivale a
homologação do mural normal nem do aplicativo inteiro nesse Firebase
QA. O teste `QA de conversas não afirma liberar o mural normal da
comunidade` verifica leitura, listagem e escrita **negadas** no
Firebase Emulator. Não confundir ausência de acesso com bug de cadastro
dos participantes no aplicativo em testes fechados.

**Consequência operacional:** criar os quatro documentos
`app_config` no futuro, mesmo com autorização expressa, **não basta**
para ativar com segurança o aplicativo completo. É necessário decidir
se o ensaio está restrito a cadastro e conversas ou se exigirá paridade
das regras do mural com QA, com revisão dos caminhos sobrepostos,
testes de negação/isolamento e autorização específica de Rules. Existe
um candidato offline de paridade `compose-parity-rules.mjs`, mas ele
**não deve ser implantado automaticamente**: tem contrato etário
experimental distinto e depende de auditoria da base e aprovação.
Não importar Rules de produção nem abrir `posts` por conveniência.

**Estado:** sem escrita remota, chat/grupos/Worker/FCM fechados,
`NO_GO`, ativação QA 60% (3/5), QA geral 29% (2/7).

## Contrato experimental de paridade do QA fechado — somente Emulator (11/11/2026)

O candidato restrito de Chat QA da PR #232 é apropriado para testar
cadastro/conversas, mas **não contém `posts` e `posts/*/replies`**.
Como o formulário normal desemboca em `OnlineCommunity`, criamos uma
**segunda alternativa exclusivamente offline**,
`firebase/qa-general/closed-qa-parity.mjs`, que parte do gerador de
paridade já versionado (o qual **fixa por SHA Git** a base
`firestore.rules`) e aplica ao laboratório o contrato adotado pelo
Fundador: autodeclaração 18+, sem whitelist ou verificador pago.

O candidato integrado **nega mural sem configuração de e-mail ativa**;
exige e-mail confirmado no Auth para ler/publicar; exige
`app_config/community_rules` ativo e aceite da versão vigente para
publicar; preserva o formulário, perfil e conta mínima do cadastro;
deixa chats e grupos FECHADOS com os quatro documentos administrativos
estagiados. O Firebase Emulator testa também tentativas de acesso
anônimo, conta sem e-mail confirmado, consentimento ausente, autoria
forjada e escrita indevida dos switches administrativos. Um fixture
exclusivamente sintético testa habilitação/desabilitação do chat.

A versão NÃO substitui a geração principal, NÃO se comunica com
Firebase/Cloudflare real, NÃO provisiona contas, NÃO cria os quatro
`app_config`, NÃO altera Rules de produção ou QA e NÃO comprova
paridade de **todas** as funcionalidades do aplicativo. O hash da
base versionada NÃO comprova igualdade com o ruleset publicado na
produção. Em eventual transição ao QA conectado, comparar Rules
remotas por leitura, avaliar colisões e rotas legadas/denúncias,
moderação, custos por leitura, limites de Rules, LGPD e rollback exato.
A publicação requer aprovação separada; não usar o arquivo gerado
como comando de deploy.

**O cadastro normal dos participantes continua a decisão operacional
do Fundador.** Testes fechados com pessoas adultas conforme sua
informação, com autodeclaração de idade sem aferição independente,
não dispensam análise jurídica do caso concreto antes de expansão.
**NO_GO — ativação QA 60%, QA geral 29%.**

## Auditoria de superfície herdada e comparação remota QA somente leitura (11/11/2026)

A alternativa `closed-qa-parity.mjs` reaproveita a base
`firestore.rules` do Git, logo **manter chat/grupos fechados
não significa que toda operação herdada esteja bloqueada**.
Os testes do Firebase Emulator documentam separadamente a
matriz de acessos que a política legada efetivamente permite:

| Rota herdada | Componente observado na base Git | Implicação antes de GO |
|---|---|---|
| `app_config/opening_video` | Leitura GET pública, inclusive sem login | Não tratar paridade como `deny-all` integral |
| `app_config/founder`, `community_rules`, `email_verification` | Leitura GET com autenticação, mesmo sem e-mail confirmado | Não incluir informações sigilosas nesses docs |
| `badges/{uid}`, `profile_photos/{uid}`, `public_profiles/{uid}` | GET por autenticado, inclusive não verificado | Rever exposição proporcional de dados de perfil |
| `profiles/{uid}`, `users/{uid}/private/account` | Apenas o titular lê; terceiros negados | Preservar isolamento no teste real |
| `user_reports/{reporterUid}__{targetUid}` | Cadastro de denúncia de conta por login autenticado, mesmo com e-mail não confirmado, independentemente do chat | Rever abuso/spam e plano de moderação; NÃO confundir com `chat_reports` |
| `posts` e respostas | Após política de e-mail válida; publicação condicionada ao aceite de regras | Cobertas pela variante offline, não pelo candidato restrito |
| `chats`, `chat_groups` | Requerem gates administrativos e elegibilidade adicional | Permanecem fechados na configuração inicial |

A rota `user_reports` é permitida pela **base Git herdada**;
o candidato restrito `self-declaration-candidate.mjs` da PR #232
ainda a nega. Nenhum dos dois comportamentos é prova de que
a rota funcione hoje no Firebase QA remoto. Este contraste
precisa ser avaliado antes de escolher qual variante, se alguma,
será implantada. Não alterar privilégios apenas para passar na CI.

Novo comando de auditoria **exclusivamente read-only no Termux
quando autorizado a verificar o estado atual**:

```bash
node scripts/chat-qa-parity-remote-readonly.mjs
```

Usa os mesmos quatro GETs do script de identidade/Rules QA já
aprovado; autenticação Firebase CLI **já existente**, alvo
`atrio-catolico-qa-geral` e pacote
`br.com.atriocatolico.chatqa`. Compara o SHA-256 das Rules
remotas QA com o SHA-256 da variante integrada calculada localmente.
Se o remoto continuar em `deny-all`, relata que a candidata
**NÃO está publicada** e `ready_for_activation=false`.
Se o remoto sair de `deny-all`, falha fechado para investigação
— NÃO altera nem restaura o Firebase automaticamente.

**Limites:** comparação remota do QA não equivale a auditar
Rules de **produção**; hash Git de `firestore.rules` não é
comprovação da publicação em produção. Logs não devem conter
UIDs reais, e-mail, tokens ou conteúdo de denúncias. A CI executa
apenas mocks; o operador não recebeu instrução de executar
o comando imediatamente. É indispensável revisão humana,
aprovação do rollout e plano de reversão exato antes de
qualquer alteração remota.

**Status:** NO_GO, QA ativação 60% (3/5), QA geral 29% (2/7);
nada modificado em Firebase real, Cloudflare, produção ou backups.

## Simplificação adotada — aproveitar Rules oficiais versionadas (11/11/2026)

**Caminho principal desta PR:** usar o arquivo já existente
`firestore.rules` como **base versionada e fixada por SHA Git**.
O compositor `firebase/qa-general/closed-qa-parity.mjs` chama o
compositor já existente `compose-parity-rules.mjs` e ajusta
**somente** os gates do QA fechado: exigência de e-mail confirmado,
aceite de regras e declaração 18+ para chat. Conserva as regras
de `posts`, `replies`, `profiles`, `user_reports` e demais
rotas presentes na base, e adiciona os fragmentos de DMs/grupos
com verificação de conflitos. **Não recria a comunidade do zero.**

O **pré-flight principal** `scripts/chat-qa-activation-preflight.mjs`
passa a usar `renderClosedQaParity(base,chat,group)` para calcular
o hash e declarar a origem do candidato. O gerador independente
`self-declaration-candidate.mjs` é mantido **somente como fixture
restritiva de testes negativos**, porque a suíte antiga verifica
ausência de acessos legados nesse cenário. **Não é o candidato
principal de homologação e nunca deve ser publicado por engano.**

**Distinção obrigatória:** `firestore.rules` é uma cópia do
repositório, **não prova, sem consulta, que corresponde exatamente
à release REAL atualmente publicada em produção**. Já existe o
verificador `scripts/termux-firestore-rules-diff-readonly.mjs`,
que consulta `atrio-catolico` exclusivamente por dois GETs
e compara hashes. Ele deve retornar `exactMatch=true`
antes de afirmarmos que copiamos as regras **publicadas**. Se
`exactMatch=false` ou erro de autorização, interromper a
preparação para publicação, investigar a divergência e revisar
a base; não sobrepor produção nem alterar arquivos automaticamente.

**Fronteiras imutáveis:** não copiar usuários ou dados da produção,
não copiar tokens, não importar credenciais no repositório,
não publicar Rules no Firebase QA enquanto houver `NO_GO`,
não abrir conversas/grupos/push e não modificar backups. O
QA remoto permaneceu `deny-all` na última captura enviada
pelo operador. A revisão de rotas herdadas e moderação da
issue #200 continua necessária mesmo quando os textos coincidirem.


## Evidência de operador — Rules de produção iguais à base versionada (11/11/2026)

**Fonte e momento:** captura do resultado executado pelo fundador no Termux e
compartilhada nesta conversa em 11/11/2026. Trata-se de **evidência do
operador**, não de uma consulta Firebase autenticada realizada pelo conector
GitHub ou de uma prova de que a publicação permanecerá inalterada no futuro.
O campo `publishedAt` é o horário da publicação remota, **não** o instante
da leitura mostrada na captura.

- Comando: `node scripts/termux-firestore-rules-diff-readonly.mjs`.
- Projeto consultado: `atrio-catolico` (produção), somente 2 GETs.
- Modo retornado: `READ_ONLY_NO_DEPLOY_NO_BACKUP`;
  `deploymentApproved=false` e `releaseApproved=false`.
- `publishedAt=2026-11-06T21:27:12.553922Z`.
- `exactMatch=true`, `publishedLines=940`, `repositoryLines=940`,
  `publishedOnlyLines=0`, `repositoryOnlyLines=0`,
  `differentRegions=0`.
- `publishedSha256=repositorySha256=aa04c106e69287b7e7f513addf3dd4e9fc3ad246b69a7d20b2f38c5068c9899e`.
- Conferência independente no GitHub: `firestore.rules` da `main`
  (HEAD observado `640c648ccd396f700b1d5f7f824cd3ea2142521d`) e da PR #232 (HEAD anterior
  `f20448dbba4df2a13b345b15d901cd2f161b0841`) têm o **mesmo blob Git**
  `526b8a1e7ff09aca79a4a539ee1681a6c0a76f77`; o SHA-256 calculado
  de ambos coincide com o da captura. Assim, a cópia local comparada
  coincide com a base versionada usada pelo compositor QA na PR.

**Limites:** o resultado só demonstra equivalência **textual no instante
observado** entre a publicação de produção e a **base** `firestore.rules`.
Não valida a segurança global, nem os fragmentos adicionais de conversas /
grupos, nem a release do Firestore **QA**. Não prova idade independente nem
aprovação de políticas. A auditoria QA remota anterior observou `deny-all`;
essa condição também exige revalidação imediatamente antes de eventual deploy.
**Não remover o bloqueio de comparação futura** do pré-flight, pois a
captura é histórica. A aprovação de merge, configuração administrativa,
regras QA, Worker/FCM, moderação, privacidade, retenção e teste físico continua
separada. **NO_GO; ativação QA 60% (3/5), QA geral 29% (2/7)**.

Nenhum deploy, merge, dado real, IAM, backup ou arquivo de produção foi
modificado por este registro; a única leitura de produção foi a consulta
realizada no Termux pelo operador.


## Evidencia IAM do QA e referencia de reversao (11/11/2026)

**Captura do operador no Termux**, executando
node scripts/termux-firebase-qa-iam-readonly.mjs. Trata-se de observacao
real feita pelo fundador, nao de consulta Firebase do conector GitHub.

- status = QA_IAM_PERMISSION_SNAPSHOT_ONLY
- Projeto = atrio-catolico-qa-geral; pacote = br.com.atriocatolico.chatqa
- 5 permissoes consultadas, 5 concedidas;
  can_read_rules_in_qa = true; may_have_publish_permissions_in_qa = true.
- rules_sha256 = cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b
- ruleset_name = projects/atrio-catolico-qa-geral/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc
- permission_check_method = POST_testIamPermissions_NO_MUTATION;
  changes_performed = false; production_contacted = false;
  permissions_do_not_prove_production_isolation = true;
  ready_for_activation = false.

A conta possui as permissoes IAM verificadas para leitura e eventual
publicacao de Rules QA. Isso NAO prova isolamento de producao nem
constitui permissao humana para implantar. O snapshot pode envelhecer.

### Referencia historica de reversao — sem executar nada

A API oficial do Firebase separa o Ruleset imutavel do ponteiro
Release (cloud.firestore). Uma reversao autorizada pode atualizar
o ponteiro de Release para um Ruleset anterior, atraves do endpoint
projects.releases.patch, que honra somente rulesetName.
**Este documento NAO autoriza nem executa PATCH.**

1. Antes de eventual rollout, consultar novamente Release e Ruleset
   do projeto QA, confirmar o projeto, a identidade e a integridade
   do hash. Interromper ante qualquer divergencia ou erro.
2. Verificar por leitura que o Ruleset historico ainda existe,
   e registrar o identificador EXATO imediatamente anterior ao rollout.
3. Obter autorizacao especifica e plano de reversao para o QA,
   separadamente de aprovacao de testes e da revisao juridica.
4. Se depois houver incidente, seguir processo humano aprovado para
   referenciar novamente o Ruleset anterior; verificar release e hash
   apos a alteracao, considerando atraso de propagacao.
5. Nao presumir que a referencia local deny-all seja copia binaria
   do Ruleset remoto; nao eliminar dados, subcolecoes ou backups.

O script exclusivamente OFFLINE
scripts/chat-qa-rollback-reference.mjs e seus testes apenas
fixam a referencia historica e recusam modificacoes de evidencia.
Nao consultam nuvem, nao criam backups nem demonstram rollback real.

Documentacao oficial:
https://firebase.google.com/docs/reference/rules/rest
https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/patch
https://firebase.google.com/docs/rules/manage-deploy

Continuam bloqueadores: governanca da issue 200, protecao dos menores,
politicas de privacidade/moderacao/retencao, revalidacao IAM e Rules QA,
quatro documentos app_config, testes em Android real e autorizacao
separada de publicacao. NO_GO; ativacao QA 60% (3/5), QA geral 29% (2/7).


## Rechecagem live read-only do Ruleset historico QA (12/11/2026)

Foi preparada uma conferencia NAO-MUTANTE, invocada manualmente no Termux
quando o operador desejar revalidar o alvo; o GitHub Actions roda
SOMENTE testes com mocks e NAO usa credenciais reais.

Comando (apenas na copia QA correta com sessao Firebase CLI existente):

    node scripts/chat-qa-rollback-live-readonly.mjs

O script reutiliza exatamente a auditoria existente
scripts/termux-firebase-qa-audit-readonly.mjs (quatro GETs para validar
identidade do projeto/aplicativo, Release e Ruleset do projeto QA).
Exige que o Ruleset atualmente apontado pela Release ainda tenha
o MESMO identificador e SHA-256 da observacao historica, além de
continuar deny-all. Qualquer erro, divergencia, troca de projeto,
liberacao de chat ou flag de GO falha fechado; nenhuma operacao
remota de escrita foi adicionada.

Mesmo que retorne QA_ROLLBACK_REFERENCE_MATCH_AT_READ_TIME_NO_GO,
isso comprova SOMENTE a leitura naquele instante: nao testa
recuperacao de versao futura, propagacao, permissoes IAM de producao,
nem constitui copia exata ou autorizacao. Caso a Release tenha mudado
legitimamente, NAO restaurar nada automaticamente: registrar a
divergencia e investigar sem tocar em producao ou backups.

Testes offline cobrem coincidencia, hash incorreto, ID de Ruleset
divergente, outro projeto, dados malformados, falsa autorizacao,
falha de autenticacao e recusa de campos pessoais extras. Nao
inventar um novo marco: NO_GO, QA ativacao 60% (3/5), geral 29% (2/7).
