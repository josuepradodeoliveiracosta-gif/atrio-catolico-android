# Worker geral de homologação do Átrio Católico (iniciando pelo chat)

**Status atualizado (08/11/2026, homologação apenas):** após autorização de
prosseguimento, o Worker `atrio-qa-geral` foi **criado e implantado
exclusivamente como bootstrap bloqueado** na Cloudflare. O banco D1
`atrio-qa-geral-db` foi criado e inicializado com o marcador de identidade
`atrio_qa_identity`. Cloudflare `workers.dev` e previews permanecem
**desativados** para esse Worker. Nenhuma credencial Firebase foi inserida,
nenhuma mensagem ou notificação é processada, e a criação do projeto
Firebase QA real pelo Termux **ainda não foi comprovada**. Essa implantação
não é a do Worker completo gerado para chat.

## Identidade da homologação geral (Worker e D1 já provisionados)

Firebase `atrio-catolico-qa-geral`, Worker `atrio-qa-geral`, D1 `atrio-qa-geral-db`.
A infraestrutura será compartilhável entre módulos, mas **somente eventos
do chat e de grupos estão atualmente permitidos**. Discussões, perfis,
Guardião, avatares e outros módulos precisam de implementação e aprovação
próprias antes da ativação. O APK `chatQa` continua isolado e específico
para o chat. As identidades e bindings Cloudflare foram conferidos por
consulta somente leitura; a configuração Firebase real depende do Termux.

## Por que é necessário

O Worker oficial em cloudflare/push-worker/src/index.js fixa PROJECT como
atrio-catolico e associa Firestore, autenticação e FCM a esse projeto.
Além disso, a política de verificação de e-mail e as rotinas legadas de bots
contêm referências ao projeto oficial. Apenas trocar a URL do APK não isola
o tráfego. **Nunca reutilizar o Worker ou os segredos oficiais para QA.**

## Preparação offline, sem conexão externa

O script cloudflare/push-worker/scripts/chat-qa-build.mjs gera exclusivamente:
- cloudflare/push-worker/src/index.general-qa.generated.js
- cloudflare/push-worker/wrangler.general-qa.generated.toml
- cloudflare/push-worker/schema.general-qa.generated.sql (somente instruções para
  provisionamento futuro do D1 QA; **não executadas** pelo gerador)

Os três arquivos gerados são ignorados pelo Git. O Worker atualmente
implantado é deliberadamente mais restritivo, conforme
`cloudflare/qa-general-worker/src/index.mjs`; o gerador abaixo prepara apenas
a próxima versão candidata, não a implanta. Antes de substituir o bootstrap,
exige-se nova aprovação, auditoria e integração Firebase real.

Os artefatos gerados são ignorados pelo Git. O script exige projeto Firebase identificado
como QA, UUID de D1 distinto do banco oficial e reescreve somente âncoras
conferidas do código-fonte original. O Worker produzido:
- deriva Auth, Firestore e FCM do projeto QA especificado na geração;
- restringe API pública a GET /health e POST /event;
- permite apenas eventos chat_message e group_message;
- recusa e-mail não verificado; não importa a política externa oficial;
- não executa a fila de bots da comunidade oficial;
- valida marcador QA, projeto e domínio da conta de serviço em tempo de execução;
- rejeita JWT do Firebase cuja audiência (`aud`) ou emissor (`iss`) não sejam
  do projeto QA, antes de chamar Identity Toolkit. A autenticação verdadeira
  **continua obrigatoriamente** no `accounts:lookup` remoto; a checagem de
  claims locais só bloqueia origens incompatíveis e não valida assinaturas;
- começa com PUSH_ENABLED=false, broadcast e Guardião desligados;
- configura **workers_dev=false e preview_urls=false** também no Worker
  **gerado como candidato**. Antes desta revisão, o gerador criava
  workers_dev=true, divergente do bootstrap fechado implantado. Agora
  ambas as versões permanecem sem endpoint público; qualquer abertura
  posterior requer revisão e autorização próprias e auditoria do Worker
  real, não bastando editar o TOML gerado;
- exige D1 com UUID distinto **e marcador SQL de projeto**. O Worker verifica
  `atrio_qa_identity` no D1 vinculado antes mesmo de responder ao `/health`
  ou processar `/event`. Ausência da tabela, marcador divergente e falhas
  de leitura levam a HTTP 503, sem consultar Firebase ou emitir FCM;
- não comprova a criação/isolamento real do banco: o marcador é defesa
  adicional contra vínculo incorreto, não substitui a auditoria do UUID/D1.

Com valores de QA obtidos e aprovados *independentemente*, o operador pode
preparar arquivos locais (sem implantar):

    export ATRIO_GENERAL_QA_PROJECT=SEU_PROJETO_FIREBASE_QA
    export ATRIO_GENERAL_QA_D1_ID=UUID_DO_BANCO_D1_EXCLUSIVO_QA
    node cloudflare/push-worker/scripts/chat-qa-build.mjs

Não salvar credenciais de servidor em Git, variáveis de build público ou APK.
O Worker QA só poderia usar FIREBASE_WEB_API_KEY e
FIREBASE_SERVICE_ACCOUNT_JSON fornecidos como **secrets do próprio Worker QA**
após revisão de identidade, permissões e restrições de rede. A conta de
serviço deve pertencer ao mesmo projeto QA do APK e do Worker. O D1 de homologação já está separado, com UUID
`cbca3131-5604-4103-a894-7c978143b731` e marcador validado via API.
A inicialização foi feita somente nesse banco QA, sem alterações em
`atrio-push-delivery`. Conferir esse UUID e o projeto Firebase aprovado
**novamente** antes de qualquer atualização. Não aplicar SQL ou configurações
no banco de produção.

## Bootstrap implantado na Cloudflare

- **Worker:** `atrio-qa-geral`, versão inicial bloqueada;
- **D1:** `atrio-qa-geral-db`, UUID `cbca3131-5604-4103-a894-7c978143b731`;
- **Marcador:** `atrio_qa_identity`, nome `atrio-qa-geral`, projeto `atrio-catolico-qa-geral`;
- **Bindings conferidos:** `PUSH_DB` vinculado ao D1 QA; switches de push,
  broadcast, Guardião e execução manual desligados; modo bootstrap ligado;
- **Alcance público:** workers.dev `enabled=false` e previews `enabled=false`;
- **Fase seguinte:** autenticação, regras, credenciais QA, APK e FCM reais
  ainda pendentes. Não publicar URL/credenciais, não liberar eventos.

A versão implantada possui `GET /health` somente em condição de
identidade do D1 correta e sempre retorna `disabled`. `POST /event` sempre
retorna 503, sem chamar Firebase. O código-fonte correspondente e testes
ficam em `cloudflare/qa-general-worker/`.

## Elegibilidade individual 18+ antes do Push — candidato QA sem deploy

O gerador de `src/index.general-qa.generated.js` reforça exclusivamente a
versão QA do Worker: para aviso de conversa privada, consulta o registro
mínimo `users/{uid}/chatAgeEligibility/current` do remetente **e** do
destinatário; para grupos, exige o registro do autor e filtra cada
participante antes do FCM. Provas ausentes, revogadas, vencidas, de
política antiga ou com campos extras não autorizam o aviso. O verificador
aceita apenas `status=eligible`, `minimumAge=18` como inteiro REST,
`policyVersion=2026-11-18plus-qa-v1` e `reviewExpiresAt` futuro.

Os testes sintéticos executam `resolveEvent` na fonte QA gerada,
com Firestore REST inteiramente simulado, verificando controles positivos,
revogação, falta de prova e filtragem por destinatário. **Não utilizam
Firebase externo nem transmitem notificações**. As Rules do Firestore
continuam sendo o controle do acesso às mensagens: a revalidação do
Worker protege apenas a emissão de avisos por uma credencial privilegiada.
Aumenta leituras por evento e exige avaliação de custos/cotas antes de
habilitar FCM real. O código de produção `src/index.js` não foi alterado.

### Segunda checagem antes do despacho (QA offline)

A seleção inicial dos destinatários não garante que a prova continue válida
até o envio. O candidato QA agora reconsulta a elegibilidade 18+ de remetente
e destinatário **depois de obter dispositivos e antes de reservar o marcador
de deduplicação no D1 e chamar o FCM**. Um registro revogado, ausente,
inválido ou indisponível impede o despacho. O mesmo bloqueio se aplica
aos destinatários de avisos de grupo. Há testes simulando revogação entre
`resolveEvent` e esta segunda conferência, além de falha de rede,
uso da mesma conta e caminho malformado.

**Limite:** os testes verificam a função e sua conexão textual no Worker
gerado; não executam envio real de FCM. A conferência adicional reduz,
mas não elimina uma janela de corrida entre Firestore e FCM, já que não
existe transação atômica entre esses serviços. Antes da ativação real,
validar também regras de grupo, custos por requisição e política de
e-mail verificado; decisões da Issue #200 continuam pendentes.

## Testes permitidos antes de um ambiente QA real

    node --test cloudflare/push-worker/scripts/chat-qa-build.test.mjs

O workflow .github/workflows/worker-bundle-dry-run-ci.yml gera um cenário
totalmente fictício, executa testes sintéticos e empacota o Worker QA
com Wrangler --dry-run, sem token e sem deployment. Nomes, números e UUID
fictícios **não são serviços provisionados**, e os artefatos não são
distribuídos.

## Portões pendentes para FCM em dois celulares

1. Aprovar Firebase QA, App ID Android, Sender ID e conta de serviço exclusiva.
2. [x] Provisionar Worker bootstrap/D1 QA separados e conferir os bindings.
   [ ] Substituir bootstrap pelo Worker real somente após aprovação própria.
3. Verificar configuração do APK chatQa real contra esses valores aprovados.
4. Revisar política etária, moderação, retenção e regras de Firestore em QA.
5. Autorizar explicitamente **um novo deploy da lógica completa somente QA**,
   antes de qualquer FCM; a criação do bootstrap não autoriza essa ativação.
6. Homologar autenticação, recusa/bloqueio, mensagens privadas/grupos e entrega
   FCM em aparelhos físicos, sem expor tokens, UIDs ou textos de conversas.
7. Só então avaliar publicação mediante aprovação independente.

**Fora o bootstrap QA descrito acima, nenhum deploy adicional, migração de dados,
alteração de Firestore oficial, merge na main, atualização Release, alteração
de Workers de produção ou backup foi executado ou está autorizado nesta etapa.**

### Revogação de participação em grupos antes do FCM (somente candidato QA)

A segunda checagem do candidato de laboratório agora diferencia DM de grupo.
Para cada destinatário de `group_message`, além de conferir a prova
de maioridade 18+ de remetente e destinatário, reconsulta o documento
do grupo e as duas autorizações de grupo. Grupo encerrado, participação
removida, documento ausente, elegibilidade revogada/vencida ou falha de
consulta impedem o envio; o marcador D1 também não é reservado nesse caso.
As mensagens individuais mantêm o caminho pré-envio já existente.

Teste offline cobre revogação ou ausência de acesso, saída de qualquer
participante, lista de integrantes inválida, fechamento do grupo e falha
de rede. Não houve FCM real, implantação, alteração de Rules ou do Worker
oficial. São **três leituras Firestore adicionais por destinatário de
grupo** no ponto pré-envio; custos e cotas precisam de revisão antes de
qualquer habilitação. A condição pode mudar após a leitura e antes do
FCM, já que os serviços não formam uma transação única. As políticas
da Issue #200 e os critérios para publicação continuam pendentes.

### Bloqueios e silenciamento alterados após a seleção (QA offline)

O Worker QA também reconsulta, antes de reservar o marcador D1,
os bloqueios nos dois sentidos entre remetente e destinatário.
Para mensagens de grupo, confere novamente o silenciamento específico
do grupo pelo destinatário. O documento de bloqueio existente em
qualquer sentido ou a opção `muted=true` impedem o push.
Em caso de indisponibilidade do Firestore o resultado é negação.

Os novos testes, executados com documentos Firestore fictícios,
simulam criação de bloqueio depois de `resolveEvent`, silenciamento
de grupo, reversão dos bloqueios e `muted=false`. Não enviam FCM,
não acessam backend real e não alteram o Worker oficial.
Essa segunda etapa acrescenta **duas leituras por destinatário**
para o bloqueio bilateral e **mais uma em grupos** para o silenciamento,
além das leituras já documentadas. Permanecem janelas de corrida até
o FCM, pendências de política #200 e avaliação de custo/cotas.

### Fechamento administrativo e estado da conversa antes de despachar (QA offline)

Após escolher destinatários e consultar dispositivos, o candidato agora
verifica mais uma vez os **gates administrativos** antes de reservar o
marcador D1 ou chamar FCM: para DMs e grupos, `app_config/conversations`
deve continuar habilitado, aprovado e com as versões esperadas; para grupos,
`app_config/chat_groups` precisa manter `enabled`, `pushEnabled`,
`minorPolicyApproved` e versão válidos. Para DMs, também reconfirma o
documento da conversa, quem participa, status `accepted` ou a solicitação
inicial `pending` legítima e a opção `muted` do destinatário. Solicitações
pendentes exigem a política de privacidade `requests=all`.

Cobertura com Firestore REST inteiramente fictício simula suspensão
administrativa entre a seleção e o envio, remoção/bloqueio do chat,
alteração de participantes, silenciamento, privacidade do primeiro contato,
versões de política inválidas e indisponibilidade do backend. Não há FCM
real, deploy ou alteração do Worker de produção.

**Custo estimado adicional por destinatário:** uma leitura do gate de chat,
mais uma de `chat_groups` em grupos, ou em DM uma do documento do chat
e uma de `chatBox` (mais uma de privacidade quando `pending`).
O custo é adicional às checagens já descritas e precisa ser auditado antes
de ligar FCM; Firestore e FCM não são atômicos, portanto não existe garantia
de revogação instantânea após a última leitura.

### Revalidação da existência da mensagem (somente QA offline)

O último controle antes do marcador D1/FCM lê novamente a mensagem que
originou o evento, depois da seleção dos destinatários. A mensagem deve
existir, ser do remetente autenticado, manter tipo permitido (DM:
`text`/`post`; grupo: `text`) e ter `createdAt` recente. Exclusão,
mudança de autoria/tipo, data antiga ou falha REST negam o push.

Novos testes simulam a seleção válida seguida da remoção/alteração da
mensagem, com controle positivo e falha de rede. A checagem vale apenas
para o candidato do Worker QA, gera **uma leitura Firestore adicional por
destinatário** e não impede alterações após essa última consulta. Nada
é enviado ao FCM real, e o Worker oficial não foi modificado.

**Atenção:** isso não implementa retenção, exclusão legal, moderação ou
garantia de revogação instantânea. Esses procedimentos continuam
dependentes da aprovação documentada da Issue #200.

### Teste da rota `/event` completa (somente simulação offline)

Além dos testes das funções internas, uma suíte agora executa o
`worker.fetch` real do código **QA gerado**, com Auth, OAuth, Firestore
REST, D1 e FCM **substituídos por objetos/fetch locais**. A chave RSA de
serviço é gerada durante o teste, não é de nenhum projeto real; o token
Firebase é um artefato falso aceito apenas pelo mock de Auth.

A seleção inicial é permitida e um documento é revogado **quando o
Worker consulta os dispositivos**. O teste confirma que exclusão de
mensagem, prova 18+ ausente, bloqueio bilateral, suspensão administrativa,
saída do grupo ou `pushEnabled=false` impedem **a reserva do marcador
D1 e a chamada simulada ao FCM**. Um controle positivo para DM e grupo
valida que o mesmo fluxo completo chega ao FCM fictício quando permitido.
O teste recusa qualquer destino HTTP imprevisto e exige explicitamente
o identificador do projeto QA em suas URLs.

**Limites:** não existe Firestore/FCM/Cloudflare real, verificação
criptográfica remota de token ou deploy. A simulação não encerra
os marcos 3–7, não elimina a janela de corrida pós-verificação e
não substitui o teste em dois aparelhos físicos.

### Deduplicação D1, retomada e falhas de entrega — simulação offline

O mock D1 da suíte completa `/event` agora mantém um conjunto de
marcadores entre requisições e simula `INSERT OR IGNORE` como no SQL
real: a primeira reserva é aceita, e a segunda para o mesmo evento
não altera linhas. A suíte cobre DM e grupo repetidos, negativa após
revogação (sem reservar marcador), restauração da permissão fictícia
e um único envio subsequente.

Um cenário adicional simula **HTTP 503 do FCM após reservar D1**:
o Worker retorna `delivery_failed`, mas uma repetição não tenta
enviar de novo. Isso comprova a escolha atual de **no máximo uma
tentativa**, evitando duplicação ao custo de perder avisos em algumas
falhas de rede/FCM. É uma limitação do candidato, **não uma entrega
garantida**; a política de retry e observabilidade precisará de
aprovação e testes antes da ativação real. Nenhum token real,
D1 remoto, FCM ou Worker publicado participa desses testes.
