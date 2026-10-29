# Guardião V2 — edições antigas rastreáveis (pré-lançamento)

**Realidade do projeto confirmada pelo criador em 29/10/2026:** o aplicativo **NÃO foi publicado** e **NÃO possui usuários reais**. Existem instalações locais e contas/bots de teste. Não descrever a aplicação como publicada nem propor migração de uma base de usuários inexistente.

## Implementação na PR #44 (somente feature branch)

- O editor Kotlin adiciona `updatedAt: FieldValue.serverTimestamp()` sempre que altera título/corpo de uma discussão.
- A regra Firestore de teste exige `updatedAt == request.time` em toda atualização de discussão, alterando somente `title`, `body`, `updatedAt`. O proprietário e `createdAt` permanecem imutáveis.
- Não há caminho especial para APKs antigos: versões locais de teste sem o novo campo terão edição negada até serem atualizadas. Isso é **aceitável no pré-lançamento** e evita uma lacuna deliberada na reanálise.
- A fila `post_edits` consulta `updatedAt DESC`, com cursor estável e checkpoint independente, inclusive para discussões criadas muito antes.
- O Guardião versiona os casos por `sourceUpdateTime` e verifica atomicamente a versão antes de gravar a revisão, impedindo decisões com evidências obsoletas.
- Respostas ainda não são editáveis pelas regras do cliente; não há necessidade de nova fila para edições de respostas.

## Testes necessários

1. APK Debug compatível compila e permite a edição legítima de uma discussão.
2. Firestore Emulator aceita edição com timestamp do servidor e bloqueia edição sem timestamp, falsificação do horário, alteração de autoria/categoria e edição por outro usuário.
3. Uma publicação antiga editada entra na fila `post_edits`, gera caso de revisão quando necessário e continua visível sem a quarentena estar habilitada.
4. A varredura continua paginada e limitada, protegida por checkpoint e sem escrita em projetos oficiais.

## Segurança e custos

A **produção não é usada** nesta fase: não publicar as regras no Firebase `atrio-catolico`, não modificar `main`, backups, Worker `atrio-push` ou qualquer instalação existente sem autorização expressa. O Firebase `atrio-catolico-qa-v2` e emuladores são os únicos alvos de QA. Não contratar Cloud Run ou serviços pagos.

O índice `replies.createdAt COLLECTION_GROUP DESCENDING` e a consulta `documents:runQuery` foram verificados `READY/query_ok` no projeto QA. Isso **não** autoriza moderar usuários ou ligar punições reais.

**Próximo objetivo:** fechar todos os testes de pré-lançamento e definir a implantação inicial segura, sem rotina de migração de usuários.
