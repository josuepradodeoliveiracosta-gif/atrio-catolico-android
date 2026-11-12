# Firestore de homologacao geral - candidato offline

Projeto alvo: atrio-catolico-qa-geral. Nenhuma credencial e armazenada aqui.

O banco QA real foi criado pelo operador com regras de negacao total.
**Nao alterar essas regras reais nesta etapa.**

O script compose-rules.mjs gera uma **fixture restritiva de regressão**, sem ler a
politica geral firestore.rules do repositório. O candidato principal de
homologação usa o compositor de paridade indicado na seção de simplificação. Reutiliza APENAS os fragmentos
de chats e grupos ja separados, mais funcoes basicas de Auth, bloqueios
privados e leitura pontual de nomes publicos. Outros caminhos sao negados.
A regra de verificacao de e-mail e mais estrita para a homologacao.
Os gates de menores e elegibilidade continuarao bloqueados quando ausentes.
A suite de emulacao usa somente projeto demo-atrio-v11 e dados ficticios,
inclusive revisoes de politica sinteticas (nao sao aprovacoes reais).

Executar localmente apenas para gerar as regras, SEM PUBLICAR:
  node firebase/qa-general/compose-rules.mjs

Arquivo de saida ignorado: tests/security/qa-general.generated.rules.
A CI qa-general-firestore.yml testa suas permissoes em emulador isolado.

NAO fazer deploy agora. A revisao de menores, retencao, moderacao,
regras QA e identidade APK/Worker ainda e necessaria antes de autorizar
ativacao de chats, grupos ou notificacoes FCM. Nao importar dados reais nem usuarios oficiais da producao. Reutilizar
apenas o texto das Rules versionadas, após comparação read-only com a
release de produção, nunca publicá-las automaticamente.

**Revisão de segurança QA (08/11):** o gerador altera apenas a âncora
`chatEnabled()` na cópia **em memória** do fragmento de conversas, para
exigir e-mail verificado inclusive em preferências, solicitações e grupos.
Se essa âncora mudar ou desaparecer, o gerador aborta. O fragmento original
e as regras de produção não são modificados. A suíte valida a recusa de uma
conta fictícia com e-mail não verificado.

**Auditoria remota opcional, SOMENTE leitura:** no clone Termux atualizado,
`node scripts/termux-firestore-qa-readonly.mjs` consulta duas vezes a API
de regras do projeto fixo `atrio-catolico-qa-geral` (uma release e um
ruleset) e informa apenas SHA-256 e se ainda está em deny-all. Falha de
permissão ou diferença nas regras não autoriza deploy. Nenhum segredo é
publicado. O Worker QA continua bootstrap bloqueado.

## Experimento paralelo de paridade com a base versionada — somente offline

**NÃO é configuração do Firebase QA publicado.** O gerador
`compose-parity-rules.mjs` combina, exclusivamente em memória, o
`firestore.rules` versionado e revisado no GitHub com os fragmentos de
conversas e grupos da PR #193. Ele mantém o arquivo original intacto e
acrescenta as rotas experimentais **antes** do `deny-all` final, sem
retirá-lo. O portão de e-mail confirmado é obrigatório no novo chat.

- A versão de referência é fixada pelo SHA do **Git blob** do
  `firestore.rules` de `main` em 09/11/2026:
  `526b8a1e7ff09aca79a4a539ee1681a6c0a76f77`.
  Qualquer mudança exige revisão manual; a geração falha fechada.
- O gerador rejeita mudanças na estrutura-base, funções duplicadas,
  conflitos das rotas críticas, abertura literal de permissão nos
  fragmentos e ausência de portões administrativos.
- `compose-parity-rules.test.mjs` confirma que **todo o texto da base
  permanece idêntico fora da inserção**. A suíte separada
  `qa-parity-firestore.test.mjs` roda no projeto **`demo-atrio-v11`**
  do Firebase Emulator e comprova acessos legados e negações de chat.
- Artefato local ignorado no Git:
  `tests/security/qa-parity.generated.rules`. Não usar com
  `firebase deploy`. O gerador **não** faz chamada de rede.
- **Atenção:** regras de caminhos sobrepostos no Firestore permitem
  acesso quando **qualquer** `allow` coincide. Logo a composição
  não é aprovada apenas por ser aditiva. Revisão humana + matriz
  de negativas em todas as coleções ainda são exigidas.

**Etapa obrigatória antes de QUALQUER publicação no Firebase QA:**
verificar por consulta read-only a release realmente implantada no
Firebase de produção (`atrio-catolico`) e compará-la ao blob
versionado. O utilitário
`scripts/termux-firestore-rules-diff-readonly.mjs` existe na
`main`, mas **não foi executado nesta etapa** e o mesmo hash no
GitHub **não comprova identidade com a nuvem**. Se divergir,
não implantar nem tentar corrigir automaticamente: investigar,
registrar nova base, rever regras sobrepostas e repetir os testes.

A homologação com QA real depende de autorização explícita, revisão
da política etária/moderação/retenção na issue #200, critérios de
LGPD, auditoria e rollback. **Não importar dados reais, credenciais
nem usuários de produção; não publicar regras, habilitar FCM ou
alterar backups.** Este experimento não substitui o laboratório
restritivo atual, que continua sendo o padrão seguro.

## Idade mínima 18 anos — protocolo sintético exclusivamente offline

O fundador alterou a idade mínima para o chat para **18 anos completos**
em 10/11/2026. A decisão anterior, de 16 anos, não está mais vigente.
Os dois geradores de Rules offline exigem a função
`qaChatAge18Eligible(request.auth.uid)` e o documento
`users/{uid}/chatAgeEligibility/current`.

Os testes usam apenas `status=eligible`, `minimumAge=18`,
`policyVersion=2026-11-18plus-qa-v1` e `reviewExpiresAt` futuro.
O usuário não pode criar, alterar, renovar ou excluir o documento.
A versão sintética anterior (limiar 16) não concede acesso ao chat.
Testes adicionais tentam apresentar (a) uma prova 16+ da política antiga
e (b) limiar 18 com versão antiga. Ambos devem negar DMs, histórico de
grupos e novos convites. Denúncias preexistentes permanecem acessíveis
ao autor conforme regras próprias, sem abrir conteúdo privado.

A fixture é um **atestado administrativo fictício** no Firebase Emulator,
não uma comprovação de idade. O campo `minimumAge=18` representa a
afirmação de que o participante alcançou o limiar, **não a idade exata**.
Não coletamos CPF, documentos nem fotos da identidade.

Os testes recusam idades-limiar 16 e 17, versão errada, revogação,
expiração e prova ausente, e validam um caso 18+ de controle positivo.
A restrição também protege histórico, mensagens e convites por meio dos
demais gates. Protocolos anteriores de denúncia conservam as regras
próprias de privacidade sem reabrir mensagens.

**NUNCA fazer deploy das regras candidatas ou criar provas sintéticas no
Firebase real.** Faltam método de aferição confiável, revisão legal,
moderação, retenção, privacidade e autorização de QA pela issue #200.
Na última auditoria, Firebase QA real ainda estava deny-all e Worker QA
em bootstrap fechado.

## Bloqueio de contato com destinatários inelegíveis — candidato offline

Além de exigir elegibilidade para quem opera o chat, os geradores QA
agora exigem a prova sintética do **destinatário** para criar uma conversa,
de **ambos os participantes** para gravar uma mensagem e de quem recebe
o convite para criar ou atualizar convites de grupos. A origem oficial
dos fragmentos é preservada; mudanças nas âncoras auditadas interrompem
a geração, sem tentar corrigir silenciosamente.

O Firebase Emulator testa a mesma solicitação de conversa e o mesmo
envio atômico: falham com a elegibilidade do destinatário ausente ou
revogada e passam quando a fixture válida é restaurada. A cobertura
estática confere a injeção dos requisitos de convites em ambos os
candidatos. Isso **não** é prova de idade, não implementa política de prevenção de
contato com menores, nem homologa fluxos reais de grupos.

## Futuro serviço de comprovação — contrato sintético assinado (sem deploy)

`age18-attestation-contract.mjs` **não integra nenhum fornecedor** nem
cria `chatAgeEligibility/current`. É um contrato offline para testes de
atestações Ed25519 geradas na própria suíte, sem chaves privadas reais.
Não deve ser importado por Cloudflare Workers, clientes Android,
Cloud Functions nem implantado em qualquer ambiente.

O contrato demonstra recusas a assinatura inválida, emissor/chave
desconhecidos, versão 16+ revogada, `ageAtLeast18=false`, UID da
conta diferente, desafio (`nonce`) trocado, expiração, extensão indevida
de validade, repetição de identificador e inclusão de dados pessoais
inesperados (CPF, nascimento). A resposta positiva se limita ao
identificador de conta e à aceitação da fixture, **não cria permissão**.

No backend real, o emissor confiável deve ser registrado pelo servidor,
a assinatura/chaves devem ser verificadas de maneira homologada, e o
desafio deve ser criado para a sessão Firebase autenticada. O uso
único (`jti`) deve ser marcado **atomicamente e persistentemente**
entre instâncias; `Set` no teste é apenas simulação. A autenticação
do emissor e a emissão posterior do registro privado de elegibilidade
precisam ocorrer somente no backend após as aprovações da Issue #200.
Chaves/nonce vindos do cliente não podem definir quem é confiável;
nunca aceitar a pré-triagem local como prova.

## Vínculo simulado da conta com o desafio de maioridade

`age18-binding-lab.mjs` ilustra a sequência **cadastro → sessão
autenticada → desafio exclusivo → atestado criptográfico → sinal mínimo**.
O callback `resolveSession` **simula** o uso futuro de um backend com
sessão Firebase **já verificada**, não uma autenticação implementada.
Um desafio diferente é emitido com aleatoriedade de sistema e associado
ao UID e ao identificador de sessão. Reemissão invalida desafios
anteriores; troca de conta/sessão, expiração, política obsoleta e replay
são negados por testes. Nenhuma data de nascimento é armazenada.

O retorno é `{simulatedOnly:true,...}`; **NUNCA cria ou atualiza
chatAgeEligibility/current**, não dá acesso ao chat e não aciona provedores.
Map/Set só servem ao laboratório — não são armazenamento persistente
nem transações atômicas distribuídas. Para futura implantação seriam
indispensáveis Firebase Admin SDK/token verificado, desafio e JTI
persistidos/consumidos atomicamente, trilha minimizada, controle de
revogação, fornecedor autenticado, mecanismo de expiração,
revisão jurídica/privacidade e autorização expressa na Issue #200.

### Regressões adicionais de sessão e confiança (emulador offline)

A suíte de vínculo de maioridade valida que o logout remove a sessão do
resolvedor **simulado** e invalida a conclusão do desafio anterior.
Mesmo UID com novo identificador de sessão não herda o desafio.
O laboratório fixa uma **cópia** da lista de chaves confiáveis
ao criar o verificador; mutação externa do objeto não pode substituir
silenciosamente a autoridade emissora. Reemissão de `nonce` já usado,
inclusive após consumo, e relógio regressivo também falham fechados.

Estas garantias são **apenas testes locais**: o resolvedor ainda
não autentica tokens Firebase; a lista de `nonce` usados e as sessões
não sobrevivem a reinícios nem são compartilhadas entre processos.
No backend futuro, validar expiração/revogação real de sessões e rotação
de chaves, fixar âncoras de confiança no servidor e consumir desafios
e `jti` com transações atômicas persistentes antes de qualquer emissão.

## Ponte offline entre atestado e Rules de chat 18+

`tests/security/qa-age18-admission-firestore.test.mjs` exercita uma
sequência **totalmente sintética** no Firebase Emulator
(`demo-atrio-v11`): cliente autenticado não pode se conceder
elegibilidade; declaração `ageAtLeast18=false` não passa no contrato
assinado; atestado válido isolado **não** libera o chat; somente
`withSecurityRulesDisabled` (representação do futuro backend
administrativo **somente no emulador**) cria um registro privado mínimo.
As regras então permitem a operação positiva sob portões fictícios,
mas novamente bloqueiam após revogação, e-mail não verificado ou
versão obsoleta da política 16+.

**Nunca copiar o bypass `withSecurityRulesDisabled` para serviço
real ou projeto de nuvem.** Este teste não autentica Firebase Auth
externo, não confirma idade, não possui provedor real, não cria
mecanismo de assinatura/consulta de identidades, não implementa
retentativa atômica distribuída e não autoriza uso público do chat.
Antes de qualquer implantação, a Issue #200 exige homologação
formal de método, LGPD, moderação, retenção, revisão das Rules
e autorização explícita separada.

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
