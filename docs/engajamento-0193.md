# Átrio Católico — Engajamento Debug 0.19.3

## Auditoria do código principal (base `48500908`)
- Discussões já têm atualizações em tempo real do Firestore e carregamento progressivo; respostas também usam listener com limite inicial de 30.
- Curtidas e salvos são coleções privadas por conta, não contagens públicas. Não criar contagem inventada.
- Resposta e notificação ao **criador da discussão** são gravadas atomicamente no mesmo batch. O Worker Cloudflare existente encaminha avisos genéricos aos participantes e segue regras próprias; não ampliar roteamento sem auditoria e deploy autorizado.
- Um mesmo UID é usado em posts, replies, badges, reports e push. O campo `authorName` de resposta é comparado com o perfil canônico nas regras.
- `profiles/{uid}` é privado: não se pode fazer busca indiscriminada por nomes ou expor emails para sugerir menções.
- É obrigatório preservar exclusões/denúncias do Guardião, administração e assinatura oficial.

## Funcionando com as regras atuais
- **Responder citando outro comentário**: escolha da resposta pelo ID carregado, visualização da citação e publicação como uma resposta de texto comum, com prefixo. Removível antes de enviar. Isso **não é uma menção de UID nem uma resposta direta persistida** até habilitar o backend.
- **Acompanhar discussão no aparelho**: salvar/remover da lista privada de até 40 threads por UID. Perfil mostra essa lista e lê os títulos reais do Firestore somente quando aberta. Não sincroniza entre aparelhos nem promete novos Push por causa do botão.
- **Participação no Perfil**: contagem com escopo explícito: próprias discussões *dentro do feed carregado*, salvos do usuário e acompanhadas localmente; não são rankings.
- **Debug 0.19.3**, `versionCode 30`. Release oficial permanece `0.19.0`, `versionCode 27`.

## Backend implementado em branch, mas não implantado
- `posts/{postId}/replies/{replyId}`: aceita, adicionalmente, `replyToId` e `replyToUid` quando o par é válido e corresponde à resposta-alvo canônica; antigas respostas continuam aceitas.
- `posts/{postId}/replies/{replyId}/reactions/{uid}`: uma reação por pessoa, com valor `heart`, `prayer` ou `light`; somente o próprio UID pode criar, atualizar ou excluir.
- `users/{uid}/followedPosts/{postId}`: seguir/desseguir persistente no Firestore, somente o dono, se a discussão existe.
- `app_config/engagement`: leitura autenticada, escrita negada no cliente. Depois de publicar e testar novas regras em produção **com aprovação explícita**, o administrador poderá criar `enabled=true` via console/SDK para habilitar respostas com metadados de UID e reações na UI. Antes disso, a UI usa citações de texto e oculta ações avançadas.
- Os testes dos três bots validam vínculos de UID corretos, falsificação de alvo, reações, privilégios e acompanhamento com Firestore emulado.

## Pendente / não chamar de pronto
- Menções gerais com sugestões e notificações para o mencionado; as regras atuais só noticiam o autor do post e o Worker precisaria de validação própria para novos destinatários.
- Totais públicos agregados de reações; a UI avançada mostra a **reação individual**, não uma contagem fabricada.
- Sincronização e notificações dos acompanhamentos entre celulares; a lista que funciona nesta versão é local. Requer migração e gerenciamento de inscrições/Worker com idempotência e controles antispam.
- Historico completo de respostas, rankings e busca global de perfis (não autorizados por privacidade/custo).
- Tema escuro global não integra este escopo.

## Custo e limites
- A lista local usa zero gravações Firestore para seguir/desseguir; ao abrir a lista, faz até **40 leituras de documentos** existentes, em paralelo e apenas uma vez por abertura. Não abre listeners por discussão.
- A citação usa o mesmo batch de reply + notificação que o sistema atual, sem novas gravações.
- Estatísticas no Perfil usam os dados já carregados, sem leituras extras.
- Quando backend for ativado: seguir cria um documento por discussão, desseguir exclui um, reação cria/atualiza/exclui um documento por pessoa; cada resposta direta acrescenta dois campos no documento já existente. A ativação exige mais testes de custo, segurança e entregabilidade.
- O push genérico existente é mantido sem alterar Worker, credenciais ou regras de produção.

## Aceite e publicação
1. Testar Firestore e bots no emulador. Confirmar que tentativa de reagir em nome de outro UID é negada.
2. Validar APK Debug, UX com fonte aumentada, resposta citada, acompanhar/desacompanhar e isolamento por conta.
3. Capturar telas reais do emulador e documentar o resultado.
4. Pedir autorização específica antes de publicar novas regras Firestore ou ativar `app_config/engagement`; não fazer migração automática.
5. Nunca mesclar PR na `main`, gerar release assinado, ativar faturamento ou alterar backup sem autorização explícita.

## Etapa seguinte implementada na branch — sincronização e avisos diretos
- **Acompanhamento sincronizado:** a UI passa a observar até 40 documentos em `users/{uid}/followedPosts` se e somente se a configuração administrativa `app_config/engagement.enabled=true` for ativada após publicação das regras. Seguir/deixar de seguir usa `set/delete` idempotentes e trata falhas de rede. Com a configuração desativada, o comportamento local já validado é preservado.
- **Notificação ao autor do comentário:** em uma resposta direta com `replyToId` e `replyToUid`, a escrita pode criar um aviso interno para o dono da resposta original, além do autor da discussão, quando são pessoas diferentes. Tudo no mesmo batch; as regras conferem que `replyToUid` é o dono da resposta alvo e que o aviso corresponde à nova resposta.
- **Identificação no Centro de Notificações:** o aviso com `replyToId` válido indica que alguém respondeu ao comentário. O botão abre a discussão existente, sem expor perfil privado ou e-mail.
- **Limites de custo:** acompanhamento sincronizado gera uma escrita ao seguir e uma exclusão ao deixar de seguir. O listener pessoal observa até 40 documentos, com leituras iniciais e em mudanças. A resposta direta acrescenta **no máximo uma notificação interna** ao destinatário distinto do dono da discussão; uma única operação batch continua agrupando as escritas. O push do Worker não foi alterado e **não existe confirmação de entrega de push para esse novo destinatário**.
- **Importação local/remota:** não há migração automática da lista local de um aparelho para o banco. Essa escolha evita misturar preferências privadas e não é apresentada como sincronização prévia.
- **Proteção de produção:** sem publicação explícita de regras e da flag, as novas chamadas sincronizadas e os avisos direcionados não serão usados no aplicativo real. Não habilitar a flag antes de validar as regras em produção.
