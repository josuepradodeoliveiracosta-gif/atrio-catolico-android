# Firestore de homologacao geral - candidato offline

Projeto alvo: atrio-catolico-qa-geral. Nenhuma credencial e armazenada aqui.

O banco QA real foi criado pelo operador com regras de negacao total.
**Nao alterar essas regras reais nesta etapa.**

O script compose-rules.mjs gera um arquivo de regras de teste sem ler a
politica geral firestore.rules da producao. Reutiliza APENAS os fragmentos
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
ativacao de chats, grupos ou notificacoes FCM. Nao importar dados reais,
usuarios oficiais nem copiar firestore.rules da producao.
