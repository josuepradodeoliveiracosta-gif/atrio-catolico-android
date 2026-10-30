# Guardião V2 — edições antigas rastreáveis (pré-lançamento)

**Estado:** o aplicativo não está publicado na Play Store, mas versões anteriores já foram instaladas para testes. Não presumir usuários públicos nem impedir edições de instalações antigas. A moderação autônoma permanece desativada.

## Implementação na PR #44 (somente feature branch)

- O editor Kotlin adiciona `updatedAt: FieldValue.serverTimestamp()` sempre que altera título/corpo de uma discussão.
- Para permitir a operação inicial **supervisionada**, a regra aceita edições de título/corpo sem `updatedAt` de APKs anteriores. Se o novo campo for enviado, exige timestamp do servidor (`request.time`). O proprietário e `createdAt` permanecem imutáveis.
- **Bloqueio de autonomia:** uma edição antiga sem `updatedAt` não entra obrigatoriamente na fila `post_edits`; por isso a varredura autônoma **NÃO pode ser ativada** com esta compatibilidade. Só rever essa decisão em lançamento separado, com migração/atualização concluída e autorização expressa.
- A fila `post_edits` consulta `updatedAt DESC`, com cursor estável e checkpoint independente, inclusive para discussões criadas muito antes.
- O Guardião versiona os casos por `sourceUpdateTime` e verifica atomicamente a versão antes de gravar a revisão, impedindo decisões com evidências obsoletas.
- Respostas ainda não são editáveis pelas regras do cliente; não há necessidade de nova fila para edições de respostas.

## Testes necessários

1. APK Debug compatível compila e permite a edição legítima de uma discussão.
2. Firestore Emulator aceita edições de APK antigo sem `updatedAt`, edições novas com timestamp do servidor, e bloqueia falsificação do horário, alteração de autoria/categoria e edição por outro usuário.
3. Uma publicação antiga editada entra na fila `post_edits`, gera caso de revisão quando necessário e continua visível sem a quarentena estar habilitada.
4. A varredura continua paginada e limitada, protegida por checkpoint e sem escrita em projetos oficiais.

## Segurança e custos

A **produção não é usada** nesta fase: não publicar as regras no Firebase `atrio-catolico`, não modificar `main`, backups, Worker `atrio-push` ou qualquer instalação existente sem autorização expressa. O Firebase `atrio-catolico-qa-v2` e emuladores são os únicos alvos de QA. Não contratar Cloud Run ou serviços pagos.

O índice `replies.createdAt COLLECTION_GROUP DESCENDING` e a consulta `documents:runQuery` foram verificados `READY/query_ok` no projeto QA. Isso **não** autoriza moderar usuários ou ligar punições reais.

**Próximo objetivo:** homologar os testes restantes, confirmar Spark/Workers Free e preparar lançamento inicial **somente com revisão humana**; a compatibilidade legada exige manter o scanner autônomo desligado.
