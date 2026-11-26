# Push Automático 1.0 — Marco 08: fechamento do laboratório REST e decisão operacional

## Resultado verificado
CI [45881025368](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/45881025368), commit 2f60d7b86ab5e482db22a9cb59b5e7f2654fa425: 157/157 testes de contrato e 35/35 testes de emulador, total 192/192; zero falhas. Publicação 10 requisições lógicas/24 leituras reservadas/3 escritas. Recuperação e transporte 39 requisições/73 leituras/2 escritas/4 chamadas D1 do Worker (exclui reservas diárias). OAuth externo não exercitado. CPU Node host: 49,609 ms; não equivale à CPU Workers. O laboratório REST está consolidado como prova experimental, não release. Nenhum FCM real, Cron ou deploy. PR #466 permanece QA.

## Decisão operacional: não promover o escritor REST como está
Workers Free confirmado pelo fundador; Firebase sem faturamento em verificação anterior. Conta de envio atual possui datastore.viewer, firebasecloudmessaging.admin e papel personalizado com firebaseauth.users.get. Não foi identificada escrita direta. O guard 07D limita o código, mas não limita o poder de uma credencial administrativa sobre o Firestore. Não criar escritor privilegiado, ampliar conta atual, criar chave nem alterar Rules apenas para concluir o projeto. Também não alegar que Cron de dois ciclos é viável em CPU/latência.

## Alternativa preferida para estudo: pendência automática em D1, Firestore somente leitura
Evidência de compatibilidade de interface:
- app/src/main/java/br/com/atriocatolico/QaConversationNotices.kt: read() obtém ID token, chama /notice via pending(), interpreta conversationId/messageId/senderUid, verifica par e consulta mensagem canônica no Firestore com Source.SERVER; receive() exige sinal refresh, TTL, sessão, permissão, opt-in; openFrom() relê o mesmo evento.
- cloudflare/push-worker/scripts/conversation-push-pilot.mjs: qaReadConversationNotice autentica destinatário, lê chatPushPending/current e revalida autorização; qaPilotAllowsNotice também depende desse documento na rota de envio.
- Portanto é possível investigar a troca exclusiva da fonte da pendência automática no servidor sem mudar o contrato JSON ou o sinal do APK 46. Não é prova de compatibilidade física nem simples substituição de caminho.

Projeto candidato:
1. Usar D1 QA existente, tabela própria de avisos automáticos, sem criar banco pago; evento único por chave derivada de rodada/chat/mensagem. Armazenar somente IDs canônicos, gerações, creation stamp, expiração original e estado, sem texto/token. Reserva atômica de slot e claim com compare-and-swap; estado incerto terminal. Nunca estender TTL 120s; FCM TTL no máximo 60s e dentro do prazo restante.
2. Firestore/Auth continuam fonte canônica de autorização; revalidar política, par, admissões, idade, bloqueio, mute, unread, mensagem e opt-in antes de publicação lógica, depois da reserva, antes do envio e antes de /notice. Não confiar em dados da entrada HTTP. Como D1 e Firestore não compartilham transação, rejeitar snapshot desatualizado e revalidar; não alegar atomicidade cross-store. Se não houver autorização atual, não enviar/retornar aviso.
3. /notice preserva autenticação, resposta mínima, comportamento fail-closed, revalidação e no-store; APK 46 ainda faz leitura canônica independente. Implementar seleção exclusiva de modo manual vs automático; pendência manual ativa deve impedir auto; impedir concorrência de publicador manual e automático por política operacional e guard; nunca sobrescrever pendência Firestore nem desativar o push existente inadvertidamente. Se coexistência segura não for demonstrada, não ativar.
4. Transporte interno real deve dispensar identidade injetada de teste. Não impersonar usuário; manter rechecagens e dedup D1 atual; revisar caminho existente de limpeza de dispositivo inválido para não fazer escrita Firestore na rota automática (conta atual sem exclusão).
5. Medir orçamento real, CPU, aquisição OAuth, D1 linhas e concorrência; não assumir que menos escritas torna CPU viável. Avaliar Cron de um ciclo, não implementar cron ainda. Recuperação de falha após claim nunca reenvia automaticamente.

## Gates de implementação e aceitação
A. Provar contrato D1 em SQLite local: chave, slot, concorrência, deadline, ativação persistente, revogação, resultado incerto, interrupção e recuperação; incluir adversários.
B. Integrar leitura e transporte na variante gerada em memória, preservar rota manual e contrato /notice, sem injeção fictícia de identidade. Testar matriz bilateral, bloqueio/mute, opt-out, read/delete, corrida de revogação e dedup compartilhada. Não aprovar até CI.
C. Auditar conta efetivamente usada pelo Worker, permissões reais, uso compartilhado e plano. Não publicar sem autorização específica, configuração de kill switch, prova de CPU Free e rollback. Ensaios somente QA. Nenhuma alteração paga. Homologação física APK 46 e eventual necessidade de novo APK somente por evidência.
D. Se alternativa não satisfizer segurança, latência ou cotas, manter modo atual e declarar impedimento, não habilitar Blaze/Workers Paid.

Conclusão: marco 08 encerra a linha REST experimental. Próximo 08A é prova D1 local sem escrita administrativa no Firestore, sem alteração remota. Não declarar 100% do Push Automático operacional; progresso de laboratório não representa entrega real.
