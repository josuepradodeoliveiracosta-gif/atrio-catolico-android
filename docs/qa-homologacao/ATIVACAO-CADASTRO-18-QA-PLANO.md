# Ativação do cadastro 18+ — plano de preparação e reversão (QA somente)

**Estado:** proposta de pré-ativação sem publicação, branch draft [#232](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/232). **Tarefa 3/5** (40% ao iniciar). Não altera Firebase/Cloudflare, usuários, `main`, APK instalado, regras oficiais, IAM ou backups.

## 1. Base observada e riscos de mudança simultânea

A leitura autenticada no Termux do fundador em 11/11/2026, `2026-11-11T01:16:22.664Z`, confirmou o projeto `atrio-catolico-qa-geral`, o pacote `br.com.atriocatolico.chatqa` e Firestore QA em **deny-all**. Hash remoto observado: `cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b`. Essa é uma **fotografia histórica**, não garantia de que a publicação atual permaneça igual em data futura.

O arquivo `firebase/qa-general/qa-deny-all-reference.rules` é uma política *equivalente* de negação total, com testes negativos; **NÃO é backup byte a byte** do Ruleset remoto. Para uma reversão à mesma release, antes de publicar seria necessário registrar (sem token) também o **nome/ID exato do Ruleset atual**, comprovar que continua acessível e dispor de IAM apropriado. Um hash, sozinho, não restaura uma release.

## 2. Candidato de regras e relatório offline

`node scripts/chat-qa-activation-preflight.mjs`

Esse comando é **somente local**, lê fragmentos QA e a referência de negação, compõe o candidato com `renderSelfDeclarationRules`, valida as âncoras de elegibilidade, e-mail, destinatários, grupos e `deny-all` residual; emite hashes e o quadro de pendências. Ele **não lê nem modifica** Firebase real; não gera configuração de deploy, não solicita credenciais e sempre indica `ready_for_deploy=false`.

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
