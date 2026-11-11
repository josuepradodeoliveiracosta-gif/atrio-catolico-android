# Átrio Católico — revisão das políticas de cadastro e comunidade para Chat QA

**Estado: MINUTA TÉCNICA / NÃO APROVADA / NO-GO.** Revisão fundada
no código da branch draft [PR #232](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/232),
sem atribuir aprovação jurídica ou operacional, sem ativação de usuários,
sem inserir o conteúdo no Firebase e sem editar `main` ou produção.

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
