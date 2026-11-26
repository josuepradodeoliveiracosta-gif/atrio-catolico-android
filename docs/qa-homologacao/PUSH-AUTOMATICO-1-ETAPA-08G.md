# Marco 08G — prova integrada da fronteira HTTP

CI 08F 45883889168: 191 contrato +36 emulador =227 aprovados. Novo teste integrado com adaptador HTTP candidato completo, D1 simulado por SQLite, REST Firestore real do emulador, contas Auth emuladas, OAuth assinado por chave RSA efêmera e FCM sintético. Nenhum acesso externo: fetch injetado aceita apenas endpoints QA previstos e traduz Firestore para loopback; método POST somente leitura, GET limitado de dispositivos, rejeita outros métodos. Verifica desativação, assinatura OAuth, cold token único, publicação/claim/revalidação/dedup, resposta /notice do destinatário autenticado, negação de outro UID, revogação de sessão e admissão, estado unknown e preservação de marcador após FCM incerto. Assert de 30 tentativas HTTP reais no ciclo sintético e 8 no notice, zero escrita Firestore pelo adaptador (fixtures de teste excluídas); nova CI pendente, não tratar valores esperados como medidos até aprovação.

## Compatibilidade operacional: ainda NÃO certificada

- O grafo candidato importa conversation-push-policy.mjs, que usa node:crypto; compatibilidade do bundle Workers precisa ser comprovada ou a identidade pura extraída, sem alterar política administrativa.
- Node/SQLite não é workerd/D1 hospedado; confirmar SQL unixepoch('subsec'), meta.changes, índices, linhas lidas/escritas e concorrência do binding real.
- Verificar conta efetiva e validSince no Identity Toolkit real, OAuth e FCM. Não criar chave nem conceder privilégios nesta fase.
- Worker Free: CPU de cron/HTTP, consumo compartilhado, latência e retenção continuam bloqueantes. Nenhuma evidência de CPU do provedor a partir da CI.
- Não registrar handler cron, rota pública adicional, migration remota nem deploy. Próximo marco 08H: preparar candidato de runtime isolado, remover dependência Node do grafo automático e validar execução local antes de propor ensaio gratuito. Preservar modo manual e APK46. Nenhum serviço pago ativado.