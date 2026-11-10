# Átrio Conversas — etapas 1, 2 e grupos experimentais isolados

Base de desenvolvimento: `main` em `626e70d7b544e549947aad5f58ae4bde8eb9a1d9`.
Origem: *Átrio Conversas — Plano Completo* (06/11/2026), páginas 3–11 e 14.

## Escopo implementado no código

- Caixa de entrada individual com busca, solicitações separadas, contador de
  mensagens não lidas, ordenação, silenciar, fixar e arquivar.
- Entrada por perfil público e perfil pessoal.
- Solicitação de contato por uma única mensagem inicial sem links, com **aceite
  explícito** do destinatário. Visualizar não aceita.
- Após aceite, mensagens de texto via transação Firestore, estados de envio e
  confirmação, carregamento incremental do histórico.
- Bloquear e desbloquear participante pela conversa, refletindo o
  bloqueio próprio em tempo real (o estado alheio permanece privado). Enquanto
  a própria situação de bloqueio não é conhecida, o compositor fica desativado;
  as regras no Firestore são a autoridade final. Denunciar uma mensagem
  selecionada não expõe a conversa inteira à moderação.
- Controle de quem pode solicitar contato: de todos ou de ninguém.
- Validação no Firestore: somente dois participantes autorizados leem;
  mídia, GIF, documento, áudio e outros tipos não são gravados;
  verificar bloqueio tanto no pedido quanto no envio; impedir autorizações
  forjadas e leitura por terceiros.
- Cloudflare Worker: evento autenticado pelo Firebase, valida mensagem
  já persistida, autor e destinatário, bloqueios e silenciamento;
  avisa FCM sem expor conteúdo. Android só exibe uma prévia genérica e
  revalida Firestore ao abrir a conversa.
- Fonte grande, botões de toque adequados, cores vinho/dourado existentes.
- **Etapa 2, parcialmente no código:** respostas citadas a uma mensagem já
  existente na mesma conversa; reações com 🙏, ❤️, 👍, 🙌 e 🕊️, uma por pessoa,
  com validação de autoria no Firestore; e compartilhamento de discussões em
  cartão exclusivamente textual (ID e título autenticado da publicação original).
  Ao abrir o cartão, o acesso à discussão é conferido novamente na consulta ao
  documento original, sem baixar imagens ou anexos do chat.
- Ao compartilhar, é necessário escolher uma conversa previamente aceita.
  Não é possível usar cartões para contornar o aceite do primeiro contato.
- **Antispam de primeiro contato:** transação entre novo chat, primeira mensagem
  e documento `users/{uid}/chatLimits/requests` de cota global por remetente.
  Regra de homologação provisória: cinco novos contatos a cada janela
  de 24 horas, com reset validado por relógio do servidor. O cliente não consegue
  zerar ou falsificar o contador, tampouco criar solicitações sem ele.
  O limite numérico deverá ser aprovado antes da implantação.
- **Antirrajada em conversa aceita:** a última identidade de envio é
  validada nas regras do Firestore, e o mesmo autor não pode enviar outra
  mensagem por três segundos consecutivos no mesmo chat. O bloqueio não
  depende apenas da interface e não aumenta as leituras de documentos
  necessárias para verificar quem enviou a última mensagem. Valor provisório
  sujeito a revisão. Respostas do outro participante não ficam bloqueadas.
  A contenção de spam global entre conversas diferentes ainda está pendente.
- **Ocultar apenas para mim:** documento pessoal para cada mensagem, com
  restauração própria, sem apagar a mensagem, denúncias ou histórico do outro.
  Os controles ficam no menu compacto de mensagens para telas menores.
- **Edição de mensagem própria** (somente texto): guarda o texto original no
  documento e apresenta a marca de editada. Se for a última mensagem,
  atualiza a prévia no mesmo commit, sem gerar um falso aviso de novo envio.
- **Remoção para os participantes** (somente texto): substitui o corpo pelo
  marcador `[Mensagem removida]`, elimina eventual campo de edição e
  sincroniza a prévia da última mensagem. Denúncias anteriores e backups
  podem conservar cópias do texto; não prometer eliminação absoluta.
- **As duas operações de alteração/remoção dependem exclusivamente de
  permissão administrativa** no documento `app_config/conversations`,
  que o APK não pode modificar. Sem essas permissões, ficam fechadas.
- **Etapa 3 (grupos, experimental):** criação privada, convite com aceite,
  administrador e promoção/revogação de função, saída/remoção, mensagens
  somente texto, quotas, denúncias específicas e acesso restrito. Código,
  regras e limites provisórios estão detalhados em
  `docs/atrio-grupos-etapa3-homologacao.md`. Não há push de grupos
  nem implantação de produção.

## O que **não** está pronto

A revisão anterior da PR teve compilação Android aprovada, além de testes
de segurança do Firestore. A revisão posterior acrescentou testes de
limite global, ocultação reversível, edição e remoção. A situação de
cada nova execução deve ser conferida no GitHub Actions da PR; a
presença dos testes no repositório **não garante a aprovação da
última revisão**. Nenhum resultado automatizado substitui os testes
em dois aparelhos com contas distintas.

**Continuam não disponíveis ao usuário final:** a própria área de chat
(ainda bloqueada no servidor), confirmações genuínas de leitura/entrega,
edição e remoção de mensagens (gates administrativos fechados por padrão),
política de proteção de menores, limitação global de mensagens
repetidas entre diferentes chats aceitos, grupos **ainda desativados** e mensagens
temporárias.

A etapa 2 teve três recursos preparados em código; nenhuma das suas
funcionalidades foi autorizada para uso em produção.

Mídia e chamadas permanecem excluídas de TODAS as etapas. Este chat não possui
criptografia ponta a ponta: o Firestore tem controles de acesso por regras,
o que é diferente de E2EE. Não anunciar criptografia ponta a ponta.

## Compatibilidade com o selo de integridade de Selos V2

O arquivo original `firestore.rules` foi **preservado byte a byte** porque
`scripts/selos-v2-production-guarded-deploy.mjs` mantém um fingerprint
criptográfico fixado da última política aprovada. Não alteramos os fingerprints,
a ferramenta protegida nem o script de deploy antigo.

As regras novas do chat estão em
`firebase/atrio-conversas-v1.rules.fragment`, e os grupos em
`firebase/atrio-grupos-v1.rules.fragment`. Os testes
`tests/security/atrio-conversas.test.mjs` e
`tests/security/atrio-grupos.test.mjs` combinam os fragmentos com a
política oficial **apenas em memória**, dentro do emulador. Esses fragmentos
não são publicados automaticamente pelo `firebase.json`.

Antes de ativar chat real, a política combinada precisa de **nova auditoria,
aprovação explícita e procedimento de deploy independente**. Nunca atualizar
o hash fixado de Selos V2 só para silenciar o CI.

## Ativação em segurança (fail-closed)

**NÃO** ativar o chat em produção somente por merge de código.
A configuração `app_config/conversations` é somente leitura no APK, alterável
por operador de serviço no Console/Admin SDK. Ausente/desativada mantém
**todos** os writes e reads novos do chat fechados. No ambiente de homologação,
após implantar e testar as regras, criar:
```json
{"enabled": true, "version": "2026-11-v1", "minorPolicyApproved": true, "safetyReviewVersion": "2026-11-safety-v1"}
```
**Esses valores não devem ser configurados em produção enquanto não houver
política de proteção de menores aprovada e um procedimento efetivo de
elegibilidade/idade.** A chave e a versão são somente barreiras de ativação,
não comprovação de idade. Um `enabled=true` sozinho jamais abre conversas.
No laboratório, essas flags são inseridas apenas no emulador, sem acessar
contas reais. Não compartilhar credenciais ou API de serviço no app.

Cada destinatário também deve optar por `requests: "all"` em
`users/{uid}/chatSettings/privacy`. Padrão é `none`.

## Riscos e limites documentados

- O plano exige política especial para menores, prazos de retenção e limites
  de taxa. Ainda não há decisão final aprovada; manter o chat desligado em
  produção.
- Uma única solicitação por par de contas, com contador transacional
  de novos contatos para o usuário; a contenção avançada de repetição e
  disparos entre conversas já aceitas ainda precisa de revisão.
- Edição e remoção para todos estão desenvolvidas com **gates de servidor
  desativados por padrão**, e exigem configurar explicitamente:
  `editEnabled: true` e `editWindowMinutes` (inteiro de 1 a 1440);
  `deleteEnabled: true` e `deleteWindowMinutes` (inteiro de 1 a 1440).
  O documento não decide os prazos reais; definir política da comunidade
  ANTES de autorizar qualquer gate. Não configurar tais valores em produção
  agora. Reações não autorizam edição ou remoção de outro usuário.
- A remoção pública não equivale a exclusão de backups, dados de denúncias
  nem arquivos administrativos; informar esse limite claramente.
- Compartilhar uma discussão não publica conteúdo no Firestore por outra via:
  o cartão guarda somente a referência e o título verificado no instante do envio.
  Se o post for removido, o aplicativo deve apresentar indisponibilidade ao abrir.
- Emoji/reação é gravado no próprio documento da mensagem para evitar um
  listener separado por reação; somente o autor da reação pode alterá-la.
- Um push pode atrasar ou não chegar; FCM aceitar o evento não prova recebimento.
- Silenciar e arquivar são preferências individuais, não equivalem a bloquear.
- Chamadas e anexos não serão acrescentados por "atalho" de compartilhamento.
- O aviso push é **genérico e privado**, sem texto, independente da opção
  `showPushPreview` (que fica desabilitada na implementação inicial).
- Mensagens entregues ao servidor não devem ser descritas como "entregues
  ao aparelho" ou "lidas": faltam confirmações de recebimento/leitura.
- O primeiro limite técnico de mensagem no código é 1.500 caracteres,
  **provisório**, sujeito à aprovação do produto antes da abertura.
- A consulta da caixa de entrada tem limite inicial de 100 conversas; deverá
  ser paginada para escala. O histórico pagina de 40 em 40.
- Este PR não executa deploy de regras, Worker, FCM nem backend, não cria
  contas reais e não altera certificado, backups protegidos, versão Release
  nem dados dos usuários.

## Correção de acesso à caixa de entrada (homologação)

A suíte instrumentada apontou `PERMISSION_DENIED` ao consultar
`chats.whereArrayContains("participants", uid).limit(100)`.
A autorização de leitura de um documento continua checando estrutura
e participação; a regra de **listagem** agora exige a filtragem por UID
e limite máximo de 100 itens, sem o teste de tipo adicional que o
verificador estático de consultas não conseguia deduzir. A regra
geral de negação permanece ativa.

Incluímos cenários de segurança para permitir a listagem do próprio
participante e recusar consulta sem filtro, em nome de terceiro,
desautenticada ou com limite excessivo. O QA Android valida o fluxo
da interface e complementa o teste de regras: ambos precisam passar
no mesmo commit antes de afirmar que a correção está homologada.

## QA de interface individual com duas contas emuladas

A suíte `AtrioConversationsEmulatorUiTest`, incluída no fluxo
`scripts/run-qa-android-emulator.sh`, exercita a interface Compose
com dois logins Firebase Auth **do emulador local**: Alice envia,
Bob vê e responde, Bob bloqueia, Alice recebe recusa do servidor
ao tentar escrever novamente e Bob desbloqueia, permitindo a retomada. Asserções verificam também a autoria
e a prévia da última mensagem. A inicialização recusa configuração
de produção e usa somente o projeto `demo-atrio-v11` e as portas
locais 9099/8089. O teste não usa push FCM real.

Na CI completa, o seed de duas contas emuladas é compartilhado com
a suíte de grupos, mas os processos de instrumentação são separados.
Para executar somente a nova suíte no ambiente de QA:
`ATRIO_QA_SUITE=AtrioConversationsEmulatorUiTest`
com `scripts/run-qa-android-emulator.sh` no runner Android isolado.
A aprovação só deve ser declarada após verificar o check na revisão
exata do código; adicionar um teste não demonstra que ele passou.

**Faltam** testes em aparelhos físicos, rede instável, acessibilidade
manual e proteção individual de menores. Não habilitar o recurso em
produção apenas porque o teste de emulador terminou sem falhas.

## Estabilização da instrumentação Android (revisão adicional)

No Android emulado, a transição após um bloqueio podia gerar tentativas
repetidas de atualizar o contador não lido, embora o Firestore recusasse
a operação. O cliente agora memoriza a tentativa associada ao último ID de
mensagem, contador e situação do chat: **não reenvia automaticamente o
mesmo update rejeitado**. O servidor continua aplicando os bloqueios, sem
exceção para o criador ou o destinatário. Uma mensagem nova ou reabertura
da conversa permite nova tentativa de sincronização.

A suíte de regras inclui ainda teste de que apenas o titular pode remover
seu bloqueio e de que o servidor volta a aceitar mensagens depois da
remoção. O último teste Android completo apontou também falhas na suíte
dos bots e nos convites de grupos; **não há homologação final** dessas
rotas. A suíte de grupos agora recebe um novo seed isolado após a suíte
privada: o seed reutiliza somente as contas QA do Auth local e restaura
a conversa aceita, a elegibilidade sintética e os bloqueios de teste.
Nenhum registro real é atingido, e o teste de segurança não muda as
regras de produção.

A segunda execução do E2E deve confirmar especificamente se a ausência
de cascata de writes e a reposição das fixtures resolvem o problema;
não inferir sucesso apenas de uma compilação ou dos testes de regras.

## Isolamento de sessão e autorização da interface (revisão de 07/11)

Nas telas de conversas individuais e de grupos, um observador de
`FirebaseAuth.AuthStateListener` agora fecha os listeners de configuração,
caixa de entrada, convites, elegibilidade e preferências quando ocorre
`signOut` ou troca de conta. Mesmo que a Activity ainda esteja visível,
os dados privados da conta anterior não devem permanecer na interface.
A autorização de verdade continua nas regras Firestore, nunca apenas
na tela Compose. Há testes instrumentados específicos para o logout
nas duas áreas.

O teste de troca de conta da conversa individual agora desmonta o
Composable antigo **antes** de sair da conta e espera a nova sessão
autenticada responder ao Firestore local antes de remontar a tela.
Isso reproduz uma navegação de logout/login sem manter listeners
privados concorrentes dos dois UIDs. O teste ainda valida envio,
resposta, bloqueio, recusa do envio bloqueado, desbloqueio e retomada.

**Comprovação pendente:** confirmar a execução de QA Android no commit
exato e examinar o relatório da instrumentação caso haja nova falha.
As políticas de menores e testes em celulares físicos permanecem
bloqueadores, independentemente dos resultados em emulador.

## Abertura por notificação sem destinatário

A navegação pode receber um ID válido de conversa antes de conseguir
identificar o outro participante, ou receber um ID sem acesso autorizado.
A consulta do nome público agora é omitida enquanto não existir um UID
de destinatário; isto impede uma exceção Android ao tentar abrir
`public_profiles/""`. Não concede acesso à conversa e mantém a mensagem
genérica de indisponibilidade, sem revelar a existência de um chat
privado. Há um cenário de UI no Firebase Auth/Firestore emulados que
verifica a abertura de chat inexistente sem crash nem compositor de texto.
A confirmação de sucesso desse teste depende do CI da revisão atual.

## Primeiro contato com aceite (UI do emulador)

Uma terceira conta exclusiva do Auth Emulator, `group.carla@qa.invalid`,
é preparada com consentimento **sintético** para receber pedidos de chat,
sem elegibilidade para grupos. O teste `primeiroContatoPedeAceiteAntesDeConversar`
percorre a interface real: Alice abre a conversa pelo perfil público, envia
a primeira mensagem, confirma o estado `pending`, encerra a sessão,
Carla lê o pedido e toca em **Aceitar**, e Alice volta a enviar somente após
a confirmação `accepted` no servidor. Todos os UIDs, mensagens e regras
ficam isolados em `demo-atrio-v11`; nenhum perfil ou aceite real foi criado.

O teste complementar de regras do Firestore já proíbe envio antes do
aceite e que outro usuário aceite pelo destinatário. A aprovação do novo
cenário depende do resultado de CI no commit exato; não significa
consentimento de uma pessoa real nem validação de idade.

## Verificações necessárias para homologação

1. Regras no emulador: nenhuma leitura externa, solicitação, aceite,
   bloqueios concorrentes, ausência de anexos, denúncias limitadas.
2. Worker: autenticação, destinatário e preferências, prevenção de duplicados,
   tokens inválidos e falha de rede.
3. Android: compilar Debug e executar testes, conferir telas pequenas e fonte
   160%/200%, teclado, rotação e ausência de controles de mídia.
4. Duas contas reais de teste: convite, aceite, conversa, silenciamento,
   bloqueio durante envio, logout e re-login no mesmo aparelho.
5. Push: aplicativo aberto, fechado e segundo plano, privacidade na tela
   bloqueada e acesso negado caso a permissão tenha mudado.
6. Validar os recursos da etapa 2 (citações, reações e cartões textuais)
   com duas contas antes de considerar a fase concluída.
7. Definir formalmente prazos e retenção para edição e remoção, sem
   habilitar automaticamente as duas flags; adotar política de proteção
   de menores e critérios de moderação proporcionais.
8. Auditar o módulo de grupos já preparado em código (convites, integrantes,
   administradores, remoção e denúncias), definir regras de menores,
   retenção, custos e testes entre contas, mantendo o recurso desativado
   até a aprovação expressa.

Revisar os resultados de CI no PR antes de qualquer merge para `main`.
