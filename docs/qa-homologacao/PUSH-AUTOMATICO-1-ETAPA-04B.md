# Push Automático 1.0 — marco 04B: coalescência antes da reserva

A CI 45868659032 aprovou o marco 04A. Este passo preserva o contrato do APK 46 e a publicação manual: uma pendência automática anterior só é substituída quando o seu outbox estiver comprovadamente pending_transport, sem claim, com recibo automático, identidade, gerações, expiração e criação canônica vinculadas, e quando a nova mensagem for a última canônica não lida e estritamente mais recente. A mesma transação marca o outbox anterior superseded_lab, mantém o recibo antigo e cria os três registros novos. Uma corrida entre claim e publicação não pode reabrir o outbox antigo. Pendências manuais, reservadas, aceitas, desconhecidas ou malformadas continuam protegidas.

Outbox novo registra a criação exata do documento; claim revalida segundos/nanos para impedir reutilização de caminho após exclusão. Documentos de laboratório antigos sem essa informação falham fechados.

Contrato puro de retentativa: máximo três agendamentos, somente defer/active_pending antes de claim, espera até vencimento da pendência com intervalo mínimo de 1s, margem restante de 10s, menor prazo entre original e nova decisão. Não agenda de fato nem persiste tentativas: próximo marco deve vincular contador e prazo de forma durável e transacional. Não repetir resultado pós-claim desconhecido. Se não houver janela, descartar aviso sem afetar a mensagem armazenada. Não há garantia de uma notificação por mensagem rápida; coalescência favorece a última canônica.

Nenhuma mudança no Android, publicador manual, Worker gerado/remoto, Rules, IAM ou deploy. Testes em emulador + contrato puro; a coalescência permanece candidata de laboratório, sujeita a CI e revisão antes de uso remoto.
