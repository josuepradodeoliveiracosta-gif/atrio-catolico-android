# Átrio Católico — barreira de gravações privilegiadas (apenas QA)

**31/10/2026 — Nunca implantar este código, schema ou token em produção.**

Esta etapa complementa a PR #84 (bloqueio por Firestore Rules) e depende da cadeia de privacidade #73 → #74 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84. A issue #72 continua bloqueadora dos testes fechados da Play.

## Por que é necessário

As Security Rules do Firebase **não restringem** o Admin SDK nem operações feitas diretamente pelos Workers confiáveis. A análise dos Workers existentes identificou pontos de escrita em:

- **Avatar Worker:** upload autenticado Cloudinary, publicação de fotos, revisão de moderação, remoção da foto, alterações de `profile_photos/{uid}` e registros D1.
- **Push Worker:** notificações internas gravadas via Firestore REST, envio FCM, limpeza de tokens inválidos, relatórios do Guardião e ações de moderação.
- **Guardian Worker:** retenção, restauração ou resolução de casos e notificações administrativas, feitas com identidade de serviço.

Nenhuma dessas operações passa automaticamente pelo novo marcador Firestore da PR #84. Por isso, a próxima barreira precisa coordenar operações em andamento antes de declarar uma conta congelada.

## Implementação de QA

- `qa-privileged-freeze-schema.sql` define duas contas **exclusivamente fictícias** (`qa-freeze-alice`, `qa-freeze-bob`) e uma tabela de operações em andamento. A restrição SQL impede o armazenamento de UIDs de produção.
- `qa-privileged-write-barrier.js` usa somente instruções SQL atômicas compatíveis com a interface D1 (`prepare().bind().all()/first()`), testadas com SQLite local.
- `begin(kind, scope)` só admite os tipos de operação definidos em código e insere um registro de execução para **todos os usuários envolvidos numa única instrução**. Se um destinatário ou autor estiver congelado ou em drenagem, não admite operação parcial.
- `beginFreeze(uid)` altera `active → draining`, impedindo imediatamente novas permissões administrativas de escrita para aquele UID.
- `finalizeFreeze(uid)` exige que **não exista operação em andamento** antes de marcar `frozen`.
- `complete(ticket, {verified})` só retira uma operação pendente após confirmação positiva em teste. Falha ou resultado desconhecido deixa o registro aberto, bloqueando a finalização até intervenção/reconciliação.
- `runQaPrivilegedOperation(...)` representa uma chamada simulada de avatar, Guardião ou push. **Não envia mensagens, grava dados, apaga arquivos ou utiliza credenciais reais.**
- Os testes `qa-privileged-write-barrier.test.js` utilizam SQLite temporário (com duas conexões), verificando concorrência, publicação de novos dados bloqueada, duas contas numa mesma notificação, falhas de Cloudinary/Firestore/FCM simuladas, estado persistente, não repetição de operação e isolamento entre usuários.

## Limitações que impedem uso em produção

1. **Nenhum Worker ativo importa ou chama o módulo**; é impossível afirmar que o bloqueio já protege usuários reais.
2. Um registro de operação que ficou pendente após falha mantém a conta em drenagem, por segurança. **Não há liberação automática por TTL**; a reconciliação precisa ser concebida e auditada.
3. O teste usa apenas duas identidades fictícias. O SQL não serve para UIDs reais, não tem endpoint de autenticação, não cria o marcador Firestore e não modifica o D1 de avatar.
4. Mesmo uma autorização atômica por D1 **não cria transação distribuída** com Firebase, Cloudinary e FCM. A arquitetura real exigirá ligar TODOS os caminhos privilegiados de gravação ao mesmo protocolo de entrada/saída, incluindo cron jobs, moderação e retries; impedir acesso por código antigo; auditar permissões IAM; realizar reconciliação de efeitos indefinidos antes de retirar tickets; e verificar dados históricos.
5. A sequência futura precisará estabelecer **D1 em `draining` e o marcador Firestore administrativo antes de qualquer declaração de congelamento completo**, aguardar todas as operações privilegiadas pendentes, reconciliar falhas, revalidar registros que possam ter sido criados no intervalo entre os dois controles e só então finalizar o freeze. A ordem entre serviços **não é atômica**: durante essa janela, clientes Firebase podem escrever antes do marcador; exige-se inventário pós-barreira e verificação independente. Jamais assumir ausência de novas gravações apenas pela presença de um marcador.
6. Sem processador completo, retenção humana, portal HTTPS de exclusão operacional e verificação real de identidade, **o requisito de exclusão de conta da Play continua não atendido**.

### Executar sem serviços externos

```bash
node --experimental-sqlite --test cloudflare/account-deletion-audit/src/qa-privileged-write-barrier.test.js
```

A CI de privacidade já executa automaticamente `cloudflare/account-deletion-audit/src/*.test.js`. Nenhuma migração, deploy, publicação de APK/AAB, alteração de backup, assinatura Android ou OTA é realizada.
