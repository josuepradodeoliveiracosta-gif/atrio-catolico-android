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
