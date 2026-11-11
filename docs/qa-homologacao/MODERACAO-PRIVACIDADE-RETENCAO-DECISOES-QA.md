# Átrio Conversas — matriz operacional de moderação, privacidade e retenção (QA)

**MINUTA PARA REVISÃO — NÃO APROVADA — NO_GO — 11/11/2026.**
Sem efeito sobre regras publicadas, usuários, Firestore real, IAM, Workers/FCM,
produções ou backups. Abrange a PR draft #232 e a issue #200; o
documento não concede papel de moderador nem autoriza retenção ou descarte.

## Decisão já tomada e preservada

O fundador definiu **18+ para conversas individuais e grupos** e
adotou **data informada/cálculo local + autodeclaração 18+ expressa** como
método operacional provisório suficiente para a fase atual **até haver
recursos financeiros** para alternativa robusta. **Não recolocar a
contratação de verificador pago como bloqueio de desenvolvimento.**
Autodeclaração não é prova independente de idade nem parecer jurídico.
A avaliação das obrigações legais aplicáveis ao serviço é separada.
A criação de conta para outras áreas não depende de autodeclaração de chat.

## Diretriz do fundador — moderação humana provisória e Guardião V2

**Decisão DEFINIDA em 11/11/2026 para todo o aplicativo:** o
**Administrador/Fundador é o responsável principal provisório
pela moderação**, podendo designar moderadores e estabelecer seu
escopo. Apenas moderadores escolhidos por ele atuarão como
moderadores. Isso **não** indica que contas específicas já tenham
recebido privilégios ou que haja substituto nomeado.

A estrutura humana permanece até o **Átrio Guardião V2** estar
adequadamente testado, homologado e autorizado para automatizar
gradualmente as tarefas. O objetivo de automatização ampla não
remove a autoridade e supervisão do fundador, o direito a recurso,
a necessidade de intervenção em casos sensíveis ou a possibilidade
de interromper a automação.

[Decisão completa e limites](DIRETRIZ-MODERACAO-HUMANA-TRANSICAO-GUARDIAO-V2.md).

**Não tratar a definição da responsabilidade principal como uma
pendência aberta.** Ainda faltam: nomeação individual e cobertura
dos moderadores, canal real, procedimentos, prazos de resposta e
retenção, revisão legal e autorizações de deploy. A issue #200
segue aberta e o estado QA permanece NO_GO.

## Evidências técnicas verificadas no código — não equivalem à operação

- `firebase/atrio-conversas-v1.rules.fragment`: protocolos
  `chat_reports/{reportId}` podem ser consultados individualmente pelo
  denunciante e por administrador habilitado; apenas o administrador
  pode listá-los. Criação depende de `chatEnabled()`, participação na
  conversa e correspondência do texto efetivo/edição. O cliente não
  altera ou elimina protocolos.
- `firebase/atrio-grupos-v1.rules.fragment`: regras equivalentes para
  `chat_group_reports/{reportId}`; criação exige grupo habilitado,
  elegibilidade e **participação atual**, além da correspondência
  do conteúdo denunciado. O revisor não recebe leitura geral das DMs
  ou dos históricos dos grupos apenas pelo cargo.
- Os dois tipos de relatório incluem **cópia do texto denunciado**
  (`reportedText`) e motivo (`reason`). São dados privados
  potencialmente sensíveis; não expor em logs, issues públicas,
  e-mails comuns, dashboards abertos ou telemetria.
- `AtrioConversations.kt`: interface de denúncia de DM escreve
  `chat_reports`; bloqueio de usuário e ocultação de mensagem não
  significam eliminação de dados. Testes de PR #193 exercitam leitura
  mínima de protocolos e restrições de acesso.
- **Limite a decidir:** após desligar o chat/grupo, as Rules negam
  a **criação de novas denúncias pelo cliente**. Ex-membros de grupos
  também não podem denunciar novos conteúdos após a saída.
  Protocolos **já existentes** continuam legíveis ao denunciante
  e à moderação; isso não equivale a oferecer um canal externo de
  denúncia tardia. **Não abrir exceção ampla nas Rules por conta própria.**
- A regressão adicional `qa-self-declaration-firestore.test.mjs`
  utiliza apenas o Firebase Emulator com fixtures fictícias para
  revalidar acesso aos protocolos existentes após suspensão, negar
  leitura do histórico e impedir alterações/exclusões por cliente.

## Perfil público — botão existente e confirmação do protocolo (11/11/2026)

A interface `PublicMemberProfile.kt` **já oferece**
`atrio-member-report` / **“Denunciar participante”**, que grava
em `user_reports` (não é rota nova). O protocolo é individual,
determinístico e sujeito às Rules originais. Ao falhar a gravação,
a interface agora tenta ler **somente o mesmo documento no servidor**
e só declara duplicidade se UID do denunciante e UID alvo
coincidirem sem cache nem escrita pendente. Troca de sessão não
permite exibir resultado de conta anterior.

O teste JUnit `ParticipantReportReceiptPolicyTest` cobre
comprovante válido, cache, escrita pendente, UID diferente e
identidade faltante; a workflow Android o executa explicitamente.
**Isso não comprova que o perfil público continue navegável após
sair de um grupo**, nem implementa recuperação de senha ou denúncia
de texto antigo. **Correção após CI `#43107512583`:**
o gerador de Rules candidatas do QA NÃO contém `user_reports`.
Logo o Firebase Emulator **nega todas as operações** nessa rota,
inclusive as de administradores. A interface `Denunciar participante`
e a definição existente no `firestore.rules` do aplicativo
não demonstram que a rota esteja liberada no QA.
A suíte agora testa explicitamente esse bloqueio, sem criar regras.

## Alternativa parcial descoberta no sistema existente — denúncia de participante

**Sem canal novo:** o arquivo de regras do aplicativo
`firestore.rules` já DEFINE
`user_reports/{reporterUid}__{targetUid}` para denúncias de contas,
independentemente do estado do chat. **Esta regra não foi incluída
nas Rules candidatas de QA, que negam a rota por padrão.** O relatório pertence
ao próprio autor; só o autor pode obtê-lo individualmente e
administrador ativo pode ler/listar os protocolos. Um usuário
comum não pode forjar o UID do denunciante, duplicar a mesma
denúncia, editar/excluir o registro ou consultar relatórios alheios.

**O que isto permite em tese:** registrar denúncia sobre a
**conduta de uma conta**, mesmo após a saída de um grupo ou
desativação de conversas, **se o usuário ainda estiver autenticado
e souber qual participante denunciar**. **Não é denúncia tardia
da mensagem:** não inclui `groupId`, `chatId`, `messageId`,
texto original nem comprova vínculo de participação. Não
afirmar que existe botão acessível em todas as telas ou
que a conta suspensa ainda consegue autenticar. Uma denúncia
contra conta inexistente não está automaticamente excluída
pela presença apenas de `validId(targetUid)`; são necessários
limites de abuso e triagem humana antes de implantação ampliada.

A suíte alternativa de Firestore Emulator
`qa-self-declaration-firestore.test.mjs` agora comprova
**bloqueio da criação, leitura, listagem, alteração e exclusão
de `user_reports` no QA, inclusive por administradores**,
com chat/grupos desligados. O teste anterior pressupôs
autorização e falhou corretamente com `PERMISSION_DENIED`
na CI `#43107512583` (15/16 testes). Não se devem
abrir permissões apenas para fazer o teste passar.
A viabilização de denúncias tardias no QA continua
dependendo de análise e autorização própria na issue #200.

## Tratamento de denúncias tardias — desenho reversível, sem canal ativo

**Situações:** um integrante deixa o grupo, a conta é suspensa ou o
chat/grupo é desativado. A denúncia interna via criação de
`chat_reports` ou `chat_group_reports` pode ser recusada, e isso
não deve eliminar a opção de solicitar ajuda, contestar medida ou
reportar risco. **A existência do botão de denúncia no app não
comprova atendimento em casos em que o recurso está bloqueado.**

**Proposta preferencial para avaliação:** um canal de suporte separado
dos históricos de mensagens, com recebimento restrito e triagem humana
antes de buscar evidências. A solicitação inicial teria somente
identificador de protocolo gerado no atendimento, conta do solicitante
após autenticação quando possível, tipo de ocorrência e relato mínimo
que o solicitante decidir fornecer. **Não coletar automaticamente**
corpo de mensagens, participantes completos, contatos, cópia de DMs,
CPF, foto de documento ou categoria religiosa. O operador não
receberia autorização para explorar mensagens privadas por ser
moderador. O canal, o backend, as permissões e a finalidade seriam
decididos em revisão específica; **nada foi criado em nuvem**.

**Ameaças e validações necessárias antes de implementação:**
1. Denúncia enviada por não membro ou conta suspensa não pode
   revelar se um grupo, pessoa ou mensagem privada existe.
2. Identificadores fornecidos pelo usuário não provam participação,
   autoria nem direito de leitura; qualquer verificação ocorre em
   backend autorizado, com escopo mínimo e log sanitizado.
3. Prevenir spam, falsificação de terceiro, envio repetido, anexos
   perigosos e exfiltração de conteúdo, com limites a aprovar.
4. O recebimento do protocolo não equivale à verificação dos fatos,
   julgamento da conta denunciada ou obrigação automática de apagar.
5. Caso urgente deve ter procedimento de proteção proporcional,
   responsáveis de plantão quando realmente disponíveis e
   encaminhamento às autoridades competentes quando aplicável;
   **sem promessa fictícia de atendimento 24 horas**.
6. Evidências relevantes exigem acesso e preservação fundamentados;
   decidir retenção e medidas de reparação, sem exclusão automática.
7. Testar revogação do acesso administrativo e ex-membro sem acesso
   a históricos, preservando o próprio protocolo existente.

**Escolhas humanas ainda necessárias:** o responsável principal
já é o Administrador/Fundador; faltam nomes de moderadores delegados
se necessários, suplência, canal de contato oficial, atendimento
a usuários sem login, forma de
comprovação da solicitação, base legal, proteção contra abuso,
metas realistas, política de dados e decisão sobre suporte após saída.
O protótipo técnico apenas define limites; **não presumir aprovação
do processo operacional pela descrição aqui apresentada**.

## Proposta de procedimento operacional — pendente de aprovação

| Fase | Procedimento proposto | Evidência/responsável exigidos |
| --- | --- | --- |
| 1. Recebimento | Receber relatório pelo protocolo autenticado. Definir canal separado para ex-integrantes, chat desativado e urgência | Canal e pessoa responsável ainda NÃO DEFINIDOS |
| 2. Triagem | Distinguir perigo iminente, possível exploração/aliciamento, assédio/ameaças, fraude/spam e demais violações; priorizar proteção e contenção | Responsável e substituto, critérios e disponibilidade PENDENTES |
| 3. Acesso | Revisor designado vê apenas protocolo pertinente; negar navegação geral em mensagens e exportação indiscriminada | Credenciais mínimas, registro de acesso e revisão de permissões PENDENTES |
| 4. Contenção | Registrar medidas proporcionais: bloquear contato, desativar recurso, suspender conta conforme procedimento aprovado; não extrapolar poderes | Critérios de decisão, controle de falsos positivos e escalonamento PENDENTES |
| 5. Evidência | Guardar somente trecho/identificadores necessários em sistema restrito com justificativa de preservação | Regras de integridade, sigilo, revisão e duração PENDENTES |
| 6. Decisão/recurso | Comunicação segura, registro mínimo do fundamento, revisão humana e possibilidade de contestação | Canal de recurso, responsável independente e prazos PENDENTES |
| 7. Encerramento | Encerrar quando motivo e estado forem documentados; distinguir fechamento do caso de exclusão de dados | Política de retenção e revisão jurídica PENDENTES |

**Metas de resposta e atendimento:** nenhuma meta operacional ou prazo
legal é afirmado neste documento. Para definir metas mensuráveis, o
fundador deve identificar cobertura humana real e o processo de
escalonamento. Em situação de ameaça grave e imediata, a atuação deve
seguir procedimento de proteção e autoridades competentes, sem
prometer monitoramento 24/7 que não exista.

**Quem pode decidir:** o fundador já responde provisoriamente pela
moderação e designará os moderadores e suplentes quando necessários;
ainda deve definir separadamente o revisor de privacidade. Uma atribuição de
`admins/{uid}` não é autorização implícita de ler mensagens
privadas, exportar histórico ou apagar provas. Qualquer operador
privilegiado exige auditoria separada e escopo mínimo.

## Inventário inicial de retenção — 13 classes para decisão

**Prazo e base jurídica de TODAS as classes: PENDENTES.**
A presença da rota abaixo não significa que haja documentos no projeto
QA real nem que cada ferramenta esteja implantada.

| # | Classe / rota ou sistema a inventariar | Risco e atenção na revisão |
| --- | --- | --- |
| 1 | Firebase Authentication (e-mail e identificador da conta) | Conta, recuperação e exclusão |
| 2 | `profiles/{uid}` | Nome público e eventuais campos legados |
| 3 | `users/{uid}/private/account` | Status do cadastro e escolhas de aviso |
| 4 | `users/{uid}/private/preferences` | Interesses, participação religiosa e paróquia; potencial dado sensível |
| 5 | `community_consents/{uid}` | Versão e timestamp de aceite de regras |
| 6 | `chatAgeEligibility/current`, `chatGroupAccess/eligibility` | Somente status, versão e vencimento; a autodeclaração não prova idade |
| 7 | `chats/{id}` e subcoleção `messages` | Mensagens privadas, edições e marcadores de remoção |
| 8 | `chatSettings`, `chatBox`, `chatHidden`, `blockedMembers`, `chatLimits` | Preferências, contatos/bloqueios e metadados; ocultar não elimina |
| 9 | `chat_groups/{id}` e subcoleção `messages` | Histórico privado, grupos ativos/encerrados e membros |
| 10 | `atrioGroupInvites`, `chatGroupBox`, `chatGroupLimits` | Convites, recusas, silêncio e quotas |
| 11 | `chat_reports` | Denúncias de DM: motivo e **trecho copiado**; preservação |
| 12 | `chat_group_reports` | Denúncias de grupo: motivo e **trecho copiado**; preservação |
| 13 | Registros operacionais, auditoria, backups, exportações e Worker/D1 (se existentes) | Segregar inventário de dados, custo, cópias e acessos privilegiados |

Cada classe **precisa** de responsável, finalidade, base legal
adequada ao tipo de dado, hipóteses de compartilhamento, prazo ou
critério aprovado, marco inicial da contagem, exceções de preservação,
acesso do titular, exclusão verificável e efeitos em backups. Dados
religiosos merecem análise específica como potencialmente sensíveis.
Não escolher prazos arbitrários (ex.: 30/90/365 dias). Uma edição,
ocultação ou exclusão do documento pai no Firestore **não comprova**
eliminação de todas as subcoleções e réplicas.

## Matriz mínima de aceitação e decisão para a issue #200

| Item | Resultado exigido antes de aprovação | Estado |
| --- | --- | --- |
| Autodeclaração 18+ como critério de produto provisório | Decisão do fundador, sem fornecedor pago obrigatório | **DECIDIDA**; não é prova de idade |
| Avaliação jurídica do acesso provável por menores | Revisão de riscos e medidas aplicáveis ao serviço real | PENDENTE |
| Responsável e substituto da moderação | Administrador/Fundador principal provisório; moderadores delegados somente por sua escolha; confirmar nomeações/cobertura e canal | **RESPONSÁVEL PRINCIPAL DEFINIDO; DESIGNAÇÕES E OPERAÇÃO PENDENTES** |
| Procedimento de risco urgente e canal pós-saída | Protocolo, triagem, resposta e teste sem acesso geral às DMs | PENDENTE |
| Recurso e responsabilização | Procedimento de revisão humana e registro mínimo | PENDENTE |
| Retenção e exclusão das 13 classes | Bases/finalidades/prazos/exceções aprovados; plano para subcoleções e backups | PENDENTE |
| Política de privacidade e termos integrais | Documentos versionados com responsável/canal do controlador | PENDENTE |
| Prova técnica QA | Testes com ausência, revogação, bloqueio, saída e suspensão; auditoria por SHA | PARCIAL: offline/emulador |
| Implantação isolada | Auditoria IAM, Ruleset e quatro documentos atuais; rollback; autorização específica | NÃO AUTORIZADA |

**Condição de GO:** completar e aprovar esses itens com identificação
de responsável, data, versão, risco residual, evidência e escopo. Não
mover status `NO_GO` para `GO` apenas porque o teste passou.
A barra específica de ativação permanece 60% (3/5), QA geral
29% (2/7) até haver marcos adicionais comprovados.

## Fontes e escopo de verificação externa

- [ECA Digital — Lei 15.211/2025, art. 9º](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm):
  para serviços/conteúdos enquadrados no artigo, a autodeclaração
  não substitui mecanismo confiável; não presumir enquadramento ou
  dispensa sem avaliação do serviço concreto.
- [ANPD — ECA Digital](https://www.gov.br/anpd/pt-br/assuntos/eca-digital/):
  orientação oficial sobre prevenção de riscos e aferição etária.
- [ANPD — orientações LGPD ao titular](https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd):
  dados ligados à convicção religiosa podem ser sensíveis.

**Proibido nesta etapa:** publicação de Rules/Workers/FCM, criação de
documentos reais, atribuição de moderador, expurgo automático,
alteração de políticas em produção, merge em `main` ou backup.

### Regressões técnicas adicionais

O teste de Firestore Emulator agora cobre revogação de
`admins/{uid}.enabled` durante a suspensão: o ex-revisor perde
acesso a `chat_reports` e `chat_group_reports`, enquanto o autor
continua podendo ler seus protocolos. Também verifica que ex-integrante
não lê grupo/mensagem nem cria novo protocolo nele, apesar de poder
ler o próprio protocolo anterior. Isso não significa que um canal
alternativo já exista ou que uma política tenha sido aprovada.

## Ficha de decisões executáveis no QA offline

O dossiê [PACOTE-DECISOES-OPERACIONAIS-ISSUE-200-QA.md](PACOTE-DECISOES-OPERACIONAIS-ISSUE-200-QA.md)
reúne as propostas e campos a aprovar na issue #200, **sem inventar
responsáveis nem prazos**. O arquivo público
ISSUE-200-GOVERNANCA-QA.json registra oito pendências por identificador,
com a autodeclaração 18+ já DECIDIDA como produto provisório.
Um novo pré-flight local valida formato, projeto, pacote e decisões;
mesmo com todas as revisões marcadas, ele **nunca autoriza deploy**.
O teste roda na workflow QA já existente, sem job ou serviço adicional.

## Melhoria dos protocolos já existentes: confirmação sem duplicação (11/11/2026)

**Sem canal novo, backend novo ou coleção nova.** As telas Android de
conversas privadas (`chat_reports`) e grupos (`chat_group_reports`)
já criam denúncias com ID determinístico por denunciante, conversa
e mensagem. A nova apresentação diferencia:

- **Sucesso confirmado** da gravação pelo Firestore;
- **Tentativa de repetição**: em caso de falha da escrita, consulta
  **apenas o documento exato da própria conta com `Source.SERVER`**,
  e só informa "já registrada" se o comprovante do servidor
  corresponder ao UID, conversa/grupo e mensagem esperados;
- **Falha não confirmada**, incluindo offline ou acesso negado:
  informar que não há confirmação. Não afirmar que a denúncia
  existe nem sugerir duplicidade sem prova;
- **Sessão alterada:** não apresentar resultado administrativo de
  uma conta anterior. Mensagens ainda pendentes de confirmação
  não podem ser denunciadas na interface; DMs removidas para
  todos não geram novos relatórios sobre o marcador de remoção.

A implementação compartilha uma verificação pura
`ChatReportReceiptPolicy`, coberta por testes JUnit de identidade,
cache, escrita pendente e campos ausentes. Firestore Rules continuam
sendo a fonte autoritativa de acesso. Este ajuste **não habilita**
denúncia após saída do grupo, não abre o chat quando suspenso,
não fornece listagem geral de denúncias, não envia notificações
e não concede permissão a moderadores.

A responsabilidade principal provisória permanece com o
**Administrador/Fundador e moderadores por ele designados**;
o Guardião V2 segue planejado, sem automação ativada.

## Regressão de moderação no QA integrado — autorização e revogação (11/11/2026)

A variante `closed-qa-parity.mjs` herda `user_reports` do
`firestore.rules` versionado. Além de testar a denúncia pelo autor,
o Firebase Emulator agora verifica que:

- um usuário comum **não consegue listar** denúncias nem revisar as
  de terceiros; uma conta autenticada com identificação administrativa
  não autoprovisionada também não;
- com `admins/{uid}.enabled=true` criado **somente pelo fixture
  privilegiado do Emulator**, o administrador consegue ler a
  denúncia e a consulta ordenada/limitada que alimenta o painel
  `UserReportsAdminPanel.kt`;
- somente a transição `pending -> reviewed`, com `reviewedBy` do
  administrador e horário do servidor, é aceita; exclusão, falsificação
  de revisor e transições arbitrárias continuam bloqueadas;
- com `enabled=false`, a leitura, listagem e alteração pelo antigo
  administrador são negadas; o denunciante ainda pode ler o **seu**
  protocolo. A revogação não apaga dados.

**Limites não resolvidos pelo teste:** a UI atual carrega **apenas
as 30 denúncias mais recentes**, e não há evidência de paginação
completa ou tratamento de todas as pendências antigas. O caminho
herdado `user_reports` aceita criação autenticada mesmo sem claim
`email_verified`; isso exige análise de abuso/spam antes de
eventual liberação do candidato de paridade. Status `reviewed`
não comprova apuração, notificação ou recurso; essas operações,
o canal de denúncia tardia, equipe/cobertura humana e retenção
permanecem **PENDENTES**.

**Escopo estrito:** a suíte usa UIDs, protocolos e conteúdos
inventados em `demo-atrio-v11`; NÃO cadastra moderador real,
NÃO implementa canal externo, NÃO concede privilégios ao
aplicativo publicado, NÃO altera Rules remotas, e NÃO é GO.

## Paginação de denúncias de participantes — candidato QA (11/11/2026)

A interface anterior `UserReportsAdminPanel.kt` usava uma
assinatura única com `limit(30)`, ocultando indefinidamente
protocolos mais antigos, inclusive pendentes. A versão QA deste
commit implementa **paginação por cursor `DocumentSnapshot`**,
consultada com `Source.SERVER` e 30 resultados visíveis por página
(`limit(31)` para detectar a seguinte), sem realizar leitura global
ou pré-carregar toda a coleção.

- Botões **Anteriores**, **Mais antigas**, **Atualizar** e
  **Tentar novamente**. A página atual pode conter registros
  analisados; **a ausência de pendências nela não afirma que
  outras páginas não as contenham**.
- Consulta somente após o gate administrativo já existente e
  validação da sessão Firebase atual. Em falha, **não apresenta cache**.
  Os cursores são isolados por `db` e `adminUid`; retornar ao topo
  ou atualizar descarta cursores posteriores.
- A alteração `pending -> reviewed` preserva os campos de auditoria
  do servidor e retira o item da lista de pendentes localmente;
  uma atualização explícita busca novamente o estado do servidor.
- Teste de Rules no Emulator utiliza **65 denúncias antigas
  sintéticas**, além de um protocolo anterior, e valida três
  páginas distintas, presença da mais antiga, negação a usuário
  comum e perda de acesso quando o administrador é revogado.

**Limitação transparente:** paginação por cursor não é uma
foto transacional da coleção inteira; a inserção concomitante
de denúncias novas pode alterar fronteiras entre páginas.
O botão **Atualizar** reinicia a consulta do topo. Não se
afirma fila de triagem global ordenada apenas por pendência,
nem prazo de atendimento ou acesso a histórico de DMs.
Em caso de múltiplos moderadores, as decisões permanecem
autorizadas pelo Firestore Rules; mensagens podem ser
atualizadas por outro operador e exigir atualização manual.

Este é **somente um candidato na PR QA**, não homologação
em celulares, implantação remota, canal tardio/externo
ou aprovação de retenção/moderação. O Firebase QA real
permanece `deny-all` na última consulta. Status `NO_GO`;
ativação QA 60% (3/5), geral 29% (2/7).

