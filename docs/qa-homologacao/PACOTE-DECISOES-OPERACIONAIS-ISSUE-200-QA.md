# Átrio Católico — pacote decisório de moderação e privacidade (issue #200)

**Minuta operacional para revisão | QA fechado | 11/11/2026 | NÃO APROVADA | NO_GO**

Este material organiza decisões para o fundador e revisores. Não implementa
canal de suporte, não publica políticas, não define prazos legais, não aprova
monitoramento contínuo nem autoriza qualquer escrita no Firebase, Cloudflare,
produção ou backups. Não colocar nomes, UIDs, denúncias, conversas ou e-mails
pessoais neste repositório público; registrar evidência privada por canal adequado.

**Nota de estado atual (12/11/2026, PR #232):** textos historicos
abaixo sobre a ausencia de `user_reports` referem-se ao **gerador
isolado de testes negativos** `self-declaration-candidate.mjs`.
A **candidata principal** de Rules agora usa
`closed-qa-parity.mjs` sobre `firestore.rules` e **herda**
`user_reports`; essa rota possui cobertura Firebase Emulator
para autor, administrador, revogacao e paginacao. Nenhuma Rules
candidata foi publicada no Firebase QA real, e a rota nao esta
operacional no QA remoto em `deny-all`. Permanecem pendentes
abuso, moderação, canal tardio e revisão jurídica. **NO_GO**.

## 1. O que não será rediscutido

**DECIDIDO PELO FUNDADOR:** idade mínima de 18 anos para mensagens privadas
e grupos. Método operacional provisório: data de nascimento informada
localmente, cálculo de idade e autodeclaração expressa 18+, sem serviço pago,
até haver orçamento para verificação mais robusta. Não confundir isso com
comprovação de idade nem com aprovação de conformidade jurídica.

A análise jurídica dos riscos de acesso provável por menores continua
pendente, sem alterar a decisão funcional. Regras de e-mail, consentimento,
bloqueios, grupos, denúncias e retenção são controles separados.

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

## Alternativa parcial sem duplicar canais

O **código do aplicativo** já define `user_reports` e o botão
**Denunciar participante**, permitindo conceitualmente denunciar
uma conta sem acessar o histórico de conversas. Entretanto,
**as Rules candidatas do QA ainda não incluem `user_reports`**:
a tentativa foi negada corretamente com `PERMISSION_DENIED`
na CI `#43107512583`. A suíte agora exige explicitamente o
bloqueio de criação/leitura/listagem mesmo por administradores,
sem abrir uma rota por conveniência.

Não está comprovado que um ex-integrante consiga acessar o
perfil depois de sair do grupo; denunciar participante não
substitui denunciar uma mensagem específica. Permanecem
pendentes atendimento tardio, recursos, procedimento humano,
retenção e privacidade. Qualquer futura abertura de rota
exigirá revisão e autorização separada.

## 2. Fluxo mínimo de denúncia proposto (ainda não operacional)

1. **Entrada dentro de conversa/grupo:** utilizar protocolos existentes
   chat_reports e chat_group_reports enquanto a Rules permitir. São cópias
   da mensagem apontada, não autorização geral de leitura de históricos.
2. **Entrada tardia/sem acesso:** uma pessoa que saiu de grupo, foi
   suspensa ou está com o chat desativado precisa de canal externo
   autenticado quando possível e com minimização de dados. **O canal
   não existe hoje e deve ser escolhido e aprovado antes de sua oferta.**
3. **Acolhimento:** informar que o recebimento não comprova os fatos.
   Coletar apenas relato mínimo e canal de retorno adequado, sem pedir
   CPF, foto, dados religiosos nem exportação automática de mensagens.
4. **Triagem humana:** identificar perigo imediato, potencial dano a
   menores, assédio/ameaça, fraude, spam e outras violações. Não tratar
   uma palavra-chave ou denúncia isolada como sanção automática.
5. **Controle de acesso:** conferir cargo ativo e necessidade, registrar
   acessos administrativos minimizados, nunca disponibilizar leitura
   irrestrita de DMs e grupos.
6. **Preservação:** manter protocolo de evidência suficiente apenas
   conforme finalidade, base legal e prazo a serem aprovados; jamais
   remover registros para impedir apuração ou acessar históricos por
   conveniência.
7. **Decisão e recurso:** decisão humana fundamentada, medida
   proporcional, aviso seguro e canal de contestação por revisor
   distinto quando houver condição operacional.
8. **Encerramento:** fechar atendimento não significa eliminar dados.
   Respeitar solicitações do titular e preservações legais aprovadas.

### Casos que precisam de simulação antes de ativar

- Autor da denúncia perde o acesso ao grupo, mas conserva somente
  seu protocolo preexistente.
- Moderador desativado deixa imediatamente de consultar denúncias.
- Denunciante tenta consultar relatos de outros usuários: negado.
- Usuário sem acesso envia pedido tardio: o canal proposto não deve
  revelar existência de grupo, mensagem ou participante privado.
- Tentativa de denúncia fabricada, repetida ou com identificador
  alheio não pode ampliar acesso; a triagem não declara culpado.
- Indisponibilidade do canal, conflito de interesse, urgência e
  ausência de equipe real precisam de caminho de contingência.

## 3. Deliberações preparadas para aprovação individual

| Frente | Escolha recomendada para discussão | Responsável e evidência pendentes |
| --- | --- | --- |
| Proteção de menores | Manter autodeclaração 18+ já escolhida, avaliar acesso provável e obrigações do serviço | Revisor jurídico/privacidade e parecer específico |
| Operação humana | **Fundador responsável principal provisório (DEFINIDO)**; moderadores somente se designados por ele e com acesso mínimo | Nomeações individuais, suplência/disponibilidade e acessos ainda pendentes |
| Canal tardio | Canal separado de relatos, com retorno autenticado quando possível, sem acesso automático a históricos | Ferramenta, acesso, custos e política de suporte |
| Urgência | Protocolo de triagem/escalonamento realista, proteção e encaminhamento conforme risco | Plantão real, critérios e contatos institucionais |
| Evidências | Exibir apenas trecho denunciado e fundamento de preservação, com auditoria sanitizada | Acesso, fundamento e procedimento de controle |
| Recurso e direitos | Recebimento de contestação, acesso e exclusão sob análise humana | Canal, identidade do solicitante e revisão independente |
| Retenção | Avaliar individualmente as 13 classes já inventariadas; jamais presumir prazo ou apagar por cronômetro | Prazo, base, exceções legais, backups e subcoleções |
| Política final | Termos, política de privacidade, controlador e contatos verificados | Revisão adequada, versão, data e autorização específica |

**Prazos de resposta:** não inventados. Precisam corresponder à equipe
disponível e aos prazos legais efetivamente aplicáveis. Não prometer
atendimento 24 horas sem equipe capaz de cumpri-lo.

## 4. Ficha de aprovação para preencher FORA do repositório público

- Qual das oito frentes e qual versão de política?
- Quem aprovou, quando, em qual competência e por qual canal seguro?
- Qual a base legal e o risco residual aceito?
- Quem executará? Há substituto e restrição de acesso?
- Qual é o procedimento de contingência para denúncia urgente?
- Qual prazo de resposta e retenção será realmente viável? Quais exceções?
- Quais testes e evidências demonstram o comportamento, sem dados reais?
- Esta autorização cobre **apenas revisão**, **QA real**, ou **produção**?
  Essas três situações exigem decisões distintas.

**Não preencher aprovações na tabela de status automaticamente.**
O arquivo ISSUE-200-GOVERNANCA-QA.json contém somente estado público
de acompanhamento, sem PII. A marca REVIEW_RECORDED significa apenas
que alguém registrou uma revisão; NÃO comprova a aprovação.
O script scripts/chat-qa-governance-preflight.mjs é estritamente
offline e retorna ready_for_qa_deploy=false até haver mecanismo
independente de aprovação/alteração controlada.

## 5. Enquadramento jurídico ainda em aberto

ANPD — Guia de escopo e obrigações do ECA Digital, 28/10/2026:
https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes

ANPD — Dados pessoais sensíveis e direitos do titular:
https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd

O enquadramento do serviço depende das funcionalidades e riscos
concretos, não apenas de declarar público adulto. Preferências
religiosas são dados potencialmente sensíveis. O conteúdo deste
documento não substitui revisão jurídica nem comprovação de
cumprimento da LGPD/ECA Digital.

## 6. Critérios de bloqueio / passo seguinte

Embora a responsabilidade principal já esteja definida pelo fundador, enquanto faltar designação operacional necessária, canal, política validada,
análise dos riscos e autorização para uso de dados reais, a issue #200
permanece aberta. O QA real não será alterado por esta minuta.
Verificar novamente IAM, Ruleset, quatro app_config e plano de
reversão imediatamente antes de qualquer publicação autorizada.
Sempre manter PR #232 em rascunho sem merge em main e sem tocar
em produção ou backups. Ativação QA: 60% (3/5); QA geral: 29% (2/7).

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

## Confirmação humana antes de registrar análise — UI de QA (11/11/2026)

O botão `Marcar como analisada` em
`UserReportsAdminPanel.kt` passa a solicitar **confirmação
explícita em diálogo**, com opção de cancelar. O texto alerta que
`status=reviewed` registra somente conferência humana do
protocolo; **não demonstra veracidade, sanção, conclusão de
recurso nem notificação do denunciante**.

O painel verifica novamente a sessão Firebase, a presença da
denúncia `pending` na página atual, a confirmação explícita
e a ausência de operação concorrente. Trocar de página ou atualizar
invalida a confirmação antiga. Em seguida, o cliente envia apenas
a transição já prevista `pending -> reviewed` com UID do
administrador e horário de servidor. **Security Rules** seguem
sendo a autoridade real: nem o diálogo nem o objeto Kotlin
`UserReportsReviewPolicy` substituem privilégios atuais ou uma
revisão humana genuína. Os testes JUnit exercitam confirmação
ausente, sessão trocada, protocolo oculto/finalizado, identidades
vazias e operação em andamento.

**Ainda não implementado/aprovado:** campos de conclusão formal
da investigação, sanção ou reversão, notificações, trilha de
justificativa, canal de contestação, segundo revisor e prazos
de atendimento. Não misturar isso com a simples confirmação
do status `reviewed`. Dados de denúncia e provas não são
removidos pelo diálogo. Sem novo backend, coleção, permissão
administrativa, Firebase remoto ou deploy. **NO_GO**.


## Guardas adicionais em callbacks de denuncias (12/11/2026)

Na variante de testes da PR #232, a busca paginada (somente
`Source.SERVER`) e o retorno de gravacao
`pending -> reviewed` de `UserReportsAdminPanel.kt`
passam a comparar a **mesma instancia de FirebaseUser** do
inicio da chamada, identidade `adminUid` e ciclo de vida
da composicao. A resposta de gravacao tambem exige
a mesma geracao da pagina (`pageIndex` e
`requestVersion`). Em logout, troca de conta, nova
autenticacao com o mesmo UID, saida da tela ou
mudanca de pagina, os callbacks antigos nao
reescrevem o estado visual atual. Consulta de
denuncias nao e disparada se a sessao atual
nao corresponder ao administrador recebido.

`UserReportsReviewPolicyTest` valida o caso
aceito e rejeicoes de UID trocado, logout,
sessao reautenticada, tela desmontada, pagina
alterada e identidade vazia. O teste ja estava
incluido na selecao explicita de JUnit Android
do workflow QA, portanto nao e necessario
duplicar passos ou alterar permissoes.

**Limites:** nao cancela gravações enviadas,
nao implementa revalidacao instantanea de
revogacao administrativa, nao presume
operacao humana aprovada nem cria canal
de recursos/denuncias tardias. Firestore Rules
continua sendo a autoridade; backend real
QA nao alterado. **NO_GO, 60% (3/5) e
29% (2/7)**; sem merge, deploy ou backups.


## Início da Central Única de Denúncias (12/11/2026)

Plano e barra de progresso disponíveis em
`CENTRAL-UNICA-DENUNCIAS-QA-PROGRESSO.md`.
A primeira entrega prepara uma entrada excepcional informativa
**somente no APK Chat QA, antes do login**, sem qualquer formulário
ou transmissão. O roteador de políticas Kotlin reconhece os
fluxos existentes (`user_reports`, `chat_reports` e
`chat_group_reports`) e nega roteamento para qualquer sessão
sem acesso. Testes unitários negativos incorporados ao CI.

Isto **não implementa** canal externo, protocolo, atendimento,
moderação real, revisor nomeado, acesso a mensagens,
política de retenção ou aprovação legal.
**NO_GO: QA global 60%, homologação geral 29%**, inalterados.
