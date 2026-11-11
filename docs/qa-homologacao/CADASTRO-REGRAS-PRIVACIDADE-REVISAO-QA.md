# Átrio Católico — revisão das políticas de cadastro e comunidade para Chat QA

**Estado: MINUTA TÉCNICA / NÃO APROVADA / NO-GO.** Revisão fundada
no código da branch draft [PR #232](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/232),
sem atribuir aprovação jurídica ou operacional, sem ativação de usuários,
sem inserir o conteúdo no Firebase e sem editar `main` ou produção.

## Decisão ratificada pelo fundador: método provisório suficiente para o projeto

**Escolha funcional e orçamentária FECHADA (11/11/2026):** 18+ para mensagens privadas e grupos; nesta fase, **data informada com cálculo local + autodeclaração expressa 18+** constituem o método provisório adotado e considerado suficiente **pelo responsável para o fluxo do projeto**, até haver disponibilidade financeira para algo mais robusto. **Não criar dependência automática de fornecedor pago** nem manter "escolher método" como pendência de produto. Isso não constitui verificação independente de idade nem dispensa avaliação legal da aplicabilidade das regras de proteção de menores. Não representar 'declared_18_plus' como 'verified'.

**Separar bloqueios:** a escolha operacional da autodeclaração está decidida; permanecem pendentes revisão de riscos legais/menores, segurança contra contato abusivo, tratamento de denúncias, moderação, retenção, termos/privacidade completos, segregação QA e autorização específica de publicação. CI e teste manual não concedem GO de deploy.

Veja docs/qa-homologacao/CHAT-AUTODECLARACAO-18-QA.md para o escopo e as limitações. A issue #200 segue aberta e não está juridicamente aprovada.

## O que o código realmente apresenta hoje

1. **Regras da Comunidade** (`CommunityRulesGate.kt`,
   `CommunityRulesPolicy.VERSION=2026-11-v1`): texto cobre respeito à
   fé católica, ameaças, assédio, ódio, dados privados, fraudes, spam,
   exploração sexual, conteúdo ilegal, falsa identidade de ministros
   religiosos e denunciabilidade com revisão pela moderação.
   **Isso é conteúdo existente no aplicativo; não há comprovação aqui de
   aprovação jurídica, capacidade operacional nem SLAs de moderação.**
2. **Confirmação de e-mail** (`EmailVerificationPolicyAccess.kt`):
   `app_config/email_verification.enabled=true` e
   `version=2026-11-v1` são necessários na variante Chat QA.
   Em ausência/erro a variante Chat QA bloqueia o acesso (diferentemente
   do rollout de compatibilidade da produção).
3. **Aceite persistente** (`CommunityRulesGate.kt`): é gravado por
   UID em `community_consents/{uid}` com
   `version=2026-11-v1` e `acceptedAt` no servidor.
   A UI aguarda resposta do Firestore. A configuração
   `app_config/community_rules` controla a exigência do aceite.
4. **Documentos legais** (`OnlineAtrioApp.kt`): a UI apresenta
   **prévia** de condições de uso e privacidade, afirmando expressamente
   que política completa, bases legais e retenção ainda requerem
   revisão. **Na variante Chat QA, essas prévias não são condições
   obrigatórias para criar a conta**, ao contrário do fluxo oficial;
   não converter a prévia em aceite jurídico válido por suposição.
5. **Maioridade** (`CHAT-AUTODECLARACAO-18-QA.md`): data de nascimento
   informada e cálculo local + confirmação 18+ são exclusivamente
   autodeclaração, sem validar idade nem reter data no servidor.
6. **Moderação/guarda** (`atrio-conversas-retencao-homologacao.md`):
   há uma minuta e testes de acesso, mas responsáveis, procedimentos
   operacionais, prazos e parecer permanecem pendentes na issue #200.

## Correção preventiva na UI Chat QA

Foi identificada uma possibilidade de **fail-open na apresentação**
das Regras da Comunidade: com `app_config/community_rules`
inexistente ou erro de leitura, `rulesGateEnabled=false` e o gate
antigo era ignorado. No **Chat QA exclusivamente**, o código agora
exige documento ativo, versão correta e snapshot **confirmado no
servidor, não cache**, antes de acessar a comunidade. Documento
ausente, flag desligada, versão incompatível, erro ou cache mantêm
a UI fechada, com saída da conta. A produção preserva a semântica de
rollout anterior. A autoridade final continua nas Firestore Rules.

Testes JUnit cobrem documento ativo, ausente, falso, versão antiga,
erro e cache. A compilação sintética do APK Chat QA verifica a
integração sem acessar Firebase de verdade.

## O que ainda precisa de deliberação humana

| Tema | Comprovação necessária | Situação |
| --- | --- | --- |
| Regras da Comunidade | Revisar texto, versão, clareza e aplicação proporcional; publicar documento aprovado | PENDENTE |
| Termos de uso | Documento integral versionado, direitos, responsabilidade, proibições e aceite aplicável | PENDENTE |
| Privacidade | Finalidades, bases legais, controlador/canal, dados sensíveis opcionais, compartilhamentos e direitos | PENDENTE |
| Retenção | Inventário das treze classes, justificativas e prazos, exceções para denúncias e backups | PENDENTE |
| Moderação | Responsáveis e substitutos, denúncia, triagem, recurso e resposta a risco urgente | PENDENTE |
| Risco etário | Avaliação de acesso provável por menores e adequação legal da autodeclaração | PENDENTE |
| QA real | Revisão IAM, rollback, quatro documentos ausentes, autorização separada e testes em dispositivos | PENDENTE |

**Importante:** a decisão anterior do fundador de usar
**data informada + autodeclaração 18+ sem serviço pago** para o
protótipo **não foi alterada**. Esta revisão não afirma que tal
procedimento seja uma verificação confiável ou suficiente para um
serviço aberto. Uma eventual ampliação de público exige análise de risco
e avaliação jurídica adequadas; não criar obstáculos pagos por
suposição, mas tampouco afirmar conformidade automaticamente.

## Estado de publicação

O operador comprovou por consulta autenticada apenas de leitura
em **11/11/2026** que os quatro documentos
`app_config/email_verification`, `app_config/community_rules`,
`app_config/conversations` e `app_config/chat_groups` estavam
**MISSING**, enquanto as Rules reais de QA continuavam deny-all.
A criação dos documentos foi preparada como **manifesto offline
create-only**, não executada. Nenhuma aprovação de publicação de regras,
documentos administrativos ou Workers foi concedida.

**Critério de GO:** aprovações e textos concretos acima, isolamento QA,
nova leitura antes da mudança, autorização específica de escrita e
validação pós-mudança. Até lá, `ready_for_activation=false` e
`ready_for_deploy=false`. Barra de ativação **60% (3/5)**;
QA geral **29% (2/7), NO_GO**.

## Verificar aceite de Regras somente após confirmação do servidor

Foi identificado que `community_consents/{uid}` podia ficar
visualmente aceito pelo cache ou por `set()` pendente, ainda sem
confirmação do servidor. **Só no APK Chat QA**, um listener com
`MetadataChanges.INCLUDE` agora exige `version=2026-11-v1`,
`isFromCache=false`, `hasPendingWrites=false` e ausência de erro.
O portão de regras `app_config/community_rules` permanece igualmente
restrito a snapshot do servidor; a produção conserva sua lógica
de rollout e as Firestore Rules continuam sendo a autoridade.
JUnit cobre ausência, versão errada, cache, erro e escrita pendente.

Aceite das regras exibidas **não** equivale à aprovação de termos e
privacidade completos; issue #200 permanece NO_GO. Nenhum deploy.

## Etapa 4 — conferência do registro de aceite e preparação das decisões

**Segurança QA (11/11/2026):** o aceite em
`community_consents/{uid}` somente libera o Chat QA quando o servidor
confirmar a versão atual **e** o campo `acceptedAt` for um timestamp,
sem dados do cache, pendência de escrita ou erro. Documento com versão
correta, mas timestamp ausente/de tipo incorreto, permanece bloqueado
apenas na variante QA. O teste JUnit distingue os casos. A existência
de `acceptedAt` é evidência técnica do registro, **não é aprovação
jurídica do conteúdo das políticas**.

### Registro de deliberação da issue #200 — ainda sem aprovações

Não marcar uma decisão como aprovada sem registrar na issue #200 o
responsável, data, justificativa, versão do documento, riscos residuais
e a revisão apropriada. As sete decisões abaixo são independentes da
aprovação de build e exigem verificação:

1. **Regras/termos:** aprovar versão e texto final da Comunidade e das
   condições de uso; definir separadamente o aceite jurídico e como
   novas versões exigirão consentimento válido.
2. **Privacidade:** finalidade/base legal por categoria, controlador e
   canal de contato, direitos do titular, compartilhamento e tratamento
   minimizado de dados religiosos opcionais.
3. **Idade/menores:** avaliar acesso provável e riscos; escolher
   aferição adequada e revogável quando necessária. A declaração
   18+ permanece apenas simulação de QA, sem comprovação de idade.
4. **Moderação:** responsável e substituto, denúncia, prazos,
   revisão humana, recurso, escalonamento urgente e proteção de
   relatos sem acesso indiscriminado a conversas privadas.
5. **Retenção:** inventário de mensagens e edições, grupos, convites,
   protocolos de denúncia, preferências, elegibilidade, trilhas de
   auditoria, backups e demandas dos titulares; prazos, exceções
   legais, subcoleções e exclusão auditável. Sem expurgo automático.
6. **Configuração QA:** confirmar isolamento do projeto/pacote/IAM,
   Ruleset remoto e quatro documentos `app_config` imediatamente
   antes; planejar reversão e criação estritamente create-only,
   `conversations.enabled=false`,
   `chat_groups.enabled=false`,
   `minorPolicyApproved=false`. Qualquer escrita requer
   autorização específica e posterior.
7. **Validação real:** somente após autorizações, testar cadastro,
   e-mail, regras e elegibilidade em aparelhos QA, inclusive
   erros, revogações, desconexão e versões erradas. Grupos, Worker/FCM
   e produção são decisões separadas.

| Registro obrigatório | Estado nesta revisão |
| --- | --- |
| Documento final, versão, responsável e revisão jurídica/privacidade | PENDENTE |
| Fundamentação, justificativa, risco residual e data | PENDENTE |
| Autorização específica para criar quatro documentos apenas no QA | NÃO CONCEDIDA |
| Inspeção contemporânea de IAM, Ruleset e documentos | REVALIDAR |
| Validação Android em dispositivos reais | NÃO REALIZADA |
| Autorização para chat, grupos ou Worker/FCM | NÃO CONCEDIDA |

Orientação de referência: ANPD, guia publicado em 28/10/2026:
https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes

**Estado:** `NO_GO`. Etapa 4 permanece aberta; tarefa de ativação
60% (3/5), QA geral 29% (2/7). Nenhum deploy, merge, modificação
em produção, Workers/FCM, `main` ou backups é autorizado por este
registro.

## Etapa 4 — confirmação do término do onboarding no servidor (Chat QA)

**Evidência de código:** em `OnlineAtrioApp.kt`, a ação de concluir o
cadastro marcava o estado local como encerrado imediatamente após solicitar
`users/{uid}/private/account.onboardingStatus=complete`, sem aguardar o
resultado de `update()`. Assim, falha de rede, permissão negada ou estado
incompatível podia encerrar visualmente o onboarding, embora a transição
não estivesse confirmada no servidor.

**Correção candidata só na variante `br.com.atriocatolico.chatqa`:**
o formulário mantém a pendência local até a confirmação assíncrona da
atualização. Enquanto aguarda, desabilita a repetição do toque e mostra
"Confirmando no servidor...". Em falha, mantém o usuário na etapa final,
mostra erro não sensível, permite nova tentativa e oferece saída da conta.
O fluxo da produção não é alterado. O estado persistente no Firestore
continua sob a autoridade das Rules. A alteração **não libera o QA real**.

**Regressão do Firebase Emulator:** após a tentativa de marcar
`complete` com e-mail ainda não verificado, o estado permanece
`pending_email`; a transição com e-mail verificado produz `complete`.
Para `community_consents/{uid}`, as Rules devem rejeitar timestamp
ausente, malformado ou literal antigo e aceitar apenas
`FieldValue.serverTimestamp()` pelo próprio UID. Essas verificações
complementam o gate Android que não aceita versão sem timestamp
confirmado.

**Limites:** compilar Android e executar Firebase Emulator no novo SHA
antes de considerar a correção validada. Mesmo com CI verde, falta
ensaio real em aparelhos, revisão humana da issue #200 e autorização
específica para qualquer publicação QA. **NO_GO; ativação 60% (3/5),
QA geral 29% (2/7).**


### Roteiro de aceitação futura do fechamento do onboarding

**Executar somente após autorização específica e publicação controlada
no Firebase QA; não executar hoje no projeto real.** Registrar o
`applicationId=br.com.atriocatolico.chatqa`, commit, variante e
evidência sanitizada de cada cenário:

| Caso | Ação do operador no APK Chat QA | Resultado exigido |
| --- | --- | --- |
| E-mail ainda não verificado | Tentar encerrar cadastro | Estado remoto `pending_email`; sem liberação |
| Falha de Rules ou escrita rejeitada | Tentar finalizar com QA ainda fechado | Permanência na tela de cadastro e mensagem de erro; `pendingUid` preservado |
| Sem rede ou gravação ainda pendente | Finalizar e observar antes de reconectar | Botão desabilitado enquanto espera; sem mostrar a comunidade por sucesso local |
| E-mail verificado e escrita aprovada em QA isolado | Finalizar com rede e conferir Firestore | `onboardingStatus=complete` confirmado no servidor antes da transição |
| Conta sai durante a espera | Acionar saída sem concluir operação | Nenhuma autorização de chat/grupos produzida somente pela interface |

A suíte automatizada cobre as regras de permissão e os formatos dos
documentos com identidades sintéticas. Ela **não substitui** o ensaio
da interface e a verificação posterior no dispositivo; não inferir
`GO` a partir do status da CI.

## Etapa 4 — minuta operacional de moderação, privacidade e retenção

O quadro de 13 classes de dados, procedimentos de denúncia, recurso,
minimização de acesso e bloqueios de aprovação está registrado em
[`MODERACAO-PRIVACIDADE-RETENCAO-DECISOES-QA.md`](MODERACAO-PRIVACIDADE-RETENCAO-DECISOES-QA.md).
A escolha provisória da autodeclaração 18+ pelo fundador permanece
**DECIDIDA**. A minuta não fixa prazos jurídicos nem autoriza
ativação; canal de denúncia pós-saída/desativação ainda requer
definição, pois as Rules não permitem nova denúncia nesse estado.
Novo teste de emulador revalida a visibilidade mínima dos protocolos
existentes, sem acesso geral a mensagens privadas.

## Pacote decisório consolidado da issue #200

A minuta [PACOTE-DECISOES-OPERACIONAIS-ISSUE-200-QA.md](PACOTE-DECISOES-OPERACIONAIS-ISSUE-200-QA.md)
organiza o fluxo proposto de denúncia, revisão humana, risco urgente,
direitos do titular e retenção. Os oito itens de governança estão em
[ISSUE-200-GOVERNANCA-QA.json](ISSUE-200-GOVERNANCA-QA.json),
**todos aguardando avaliação**; a escolha funcional da autodeclaração
18+ continua **DECIDIDA** e não há contratação de verificador pago.

O pré-flight `node scripts/chat-qa-governance-preflight.mjs`
é somente local, rejeita campos inesperados e tentativas de elevar
o marcador de revisão a "APPROVED" e sempre retorna NO_GO para
deploy QA/produção. Ele não verifica assinaturas humanas nem substitui
o registro formal na issue #200. O workflow QA existente testa o
contrato sem credenciais, chamadas remotas ou serviços novos.
