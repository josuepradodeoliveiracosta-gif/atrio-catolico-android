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

**Escolhas humanas ainda necessárias:** canal de contato oficial,
responsável e suplente, atendimento a usuários sem login, forma de
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

**Quem pode decidir:** o fundador designará responsável e suplente
para a moderação e revisor de privacidade. Uma atribuição de
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
| Responsável e substituto da moderação | Identificação e aceitação explícitas, canal de atendimento | PENDENTE |
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
