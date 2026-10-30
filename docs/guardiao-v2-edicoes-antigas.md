# Guardião V2 — edições rastreáveis antes do lançamento

**Estado confirmado pelo responsável em 30/10/2026:** o aplicativo ainda não foi publicado e as versões antigas já não são usadas. Não é necessário manter compatibilidade de edição com APKs antigos. A moderação automática continua desativada por razões financeiras, técnicas e de autorização.

## Implementação na PR #44 (somente feature branch)

- O editor Kotlin adiciona `updatedAt: FieldValue.serverTimestamp()` sempre que altera título/corpo de uma discussão.
- A regra Firestore exige `updatedAt == request.time` em toda edição de título/corpo, usando o horário do servidor. O proprietário e `createdAt` permanecem imutáveis.
- Não há exceção para APKs antigos porque não são mais usados. Edições sem `updatedAt` serão bloqueadas, evitando lacunas na fila `post_edits`. **Isso não autoriza varredura autônoma**: o plano gratuito real, a identidade do servidor, as cotas, a homologação e a aprovação expressa continuam pendentes.
- A fila `post_edits` consulta `updatedAt DESC`, com cursor estável e checkpoint independente, inclusive para discussões criadas muito antes.
- O Guardião versiona os casos por `sourceUpdateTime` e verifica atomicamente a versão antes de gravar a revisão, impedindo decisões com evidências obsoletas.
- Respostas ainda não são editáveis pelas regras do cliente; não há necessidade de nova fila para edições de respostas.

## Testes necessários

1. APK Debug compatível compila e permite a edição legítima de uma discussão.
2. Firestore Emulator aceita edições com timestamp do servidor, bloqueia edições sem `updatedAt` e rejeita falsificação do horário, alteração de autoria/categoria e edição por outro usuário.
3. Uma publicação antiga editada entra na fila `post_edits`, gera caso de revisão quando necessário e continua visível sem a quarentena estar habilitada.
4. A varredura continua paginada e limitada, protegida por checkpoint e sem escrita em projetos oficiais.

## Segurança e custos

A **produção não é usada** nesta fase: não publicar as regras no Firebase `atrio-catolico`, não modificar `main`, backups, Worker `atrio-push` ou qualquer instalação existente sem autorização expressa. O Firebase `atrio-catolico-qa-v2` e emuladores são os únicos alvos de QA. Não contratar Cloud Run ou serviços pagos.

O índice `replies.createdAt COLLECTION_GROUP DESCENDING` e a consulta `documents:runQuery` foram verificados `READY/query_ok` no projeto QA. Isso **não** autoriza moderar usuários ou ligar punições reais.

**Próximo objetivo:** homologar os testes restantes, confirmar Spark/Workers Free e preparar lançamento inicial **somente com revisão humana**. O scanner autônomo continua desligado independentemente da compatibilidade.
