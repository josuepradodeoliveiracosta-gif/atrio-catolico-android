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
