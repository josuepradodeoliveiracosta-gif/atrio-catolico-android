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
- Bloquear participante e denunciar uma mensagem selecionada, sem expor
  a conversa inteira ao painel de moderação.
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
política de proteção de menores, limitação mais avançada de mensagens
repetidas entre chats aceitos, grupos **ainda desativados** e mensagens
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
{"enabled": true, "version": "2026-11-v1"}
```
O valor é exclusivamente para homologação **após** revisar política de menores,
privacidade e abusos. Não compartilhar credenciais ou API de serviço no app.

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
