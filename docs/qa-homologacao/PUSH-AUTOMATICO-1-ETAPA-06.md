# Push Automático 1.0 — Marco 06: consolidação e decisão de homologação

**Decisão: GO para laboratório; NO-GO para ativação remota.** Base verificada: `421c7b8d33b443950fa2aba0639259225885afda`, CI [45876958680](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/45876958680), contrato 132/132 e emulador 35/35. APK 46 preservado. PR #466 em ramo QA; não é autorização de merge/deploy.

## Evidência registrada

| Ciclo | HTTP lógicos | Leituras reservadas | Escritas | Chamadas D1 do Worker |
|---|---:|---:|---:|---:|
| Publicação | 10 | 24 | 3 | 0 |
| Recuperação e transporte | 39 | 73 | 2 | 4 |

Valores do ensaio com um dispositivo sintético; D1 da reserva diária não incluído na coluna Worker. Auth SDK cobrado logicamente, slots OAuth externos não exercitados. Não são leituras faturadas. CPU host Node no segundo ciclo: 115,260 ms (user + system), NÃO é CPU isolada da Cloudflare. Sem evidência de caber em 10 ms Cron Free. Limite nominal 13/50 HTTP para publicação e 50/50 para recuperação/entrega incluindo dois slots OAuth, sem margem adicional no pior caso. Envelope diário: 16.820 tentativas de leitura, 1.000 escritas/exclusões combinadas e 9.620 HTTP sem aquisição externa de credenciais; até 12.500 HTTP considerando dois slots por cada 1.440 ticks. Até 33.640 leituras em sobreposição UTC/Pacific, fora índices, tráfego manual e restante do app. Não há certificação de custo, capacidade ou plano da conta.

## Gates bloqueantes (todos necessários)

- [ ] Confirmar billing desativado no Firebase QA e plano Workers Free efetivo, limites e consumo compartilhado atuais, incluindo D1 por linha, Auth, Firestore e FCM. Não habilitar APIs, cartões ou plano pago.
- [ ] Concluir auditoria IAM: identidade efetiva do runtime, acesso herdado e cross-project, papéis mínimos; listagem de contas anterior recebeu 403. Não conceder Owner/Editor nem reutilizar autoridade ampla sem revisão. Firestore IAM não restringe por coleção. Proteger segredo e limitar projeto/escopo; nunca ler valores de segredos para auditoria.
- [ ] Implementar fronteira real, independente e desabilitada por padrão. Nenhuma injeção de identidade do harness, impersonação Firebase, OIDC fictício ou confiança em UID do cliente. Garantir desativação independente do push manual. Credenciais, adapters, D1, política de coexistência, retenção e rollback precisam de revisão. Código gerado atual tem somente fetch, não scheduled.
- [ ] Validar CPU no runtime e medir aquisição de credencial, chamadas reais por estágio, frio/quente, capacidade de um dispositivo e falhas. Um teste local não prova CPU da rede hospedada. Qualquer ensaio hospedado exige autorização específica e confirmação de plano gratuito; permanecer desabilitado caso não seja viável. Sem ativação de serviço pago como solução.
- [ ] Decidir tratamento de latência: o Cron em dois ciclos pode exceder a validade de 120 s, mesmo com cadência de um minuto; não estender TTL. Definir descarte seguro quando pending está ativo; coalescência/retry REST ainda não implementados. Alternativa a avaliar: sinal Android autenticado após commit, tratado somente como dica; validação canônica do servidor e recuperação limitada continuam obrigatórias. Não equivale a trigger independente do remetente.
- [ ] Aprovar isolamento de QA e CI do candidato realmente implantável, preservar APK 46 e main; autorização explícita do fundador antes de qualquer mudança remota.

## Homologação física (apenas depois dos gates)

Registrar ID de rodada, hash de código/configuração, versão APK em ambos os dispositivos, estado de cobrança e horário de ativação persistente. Sem conteúdo de mensagens, tokens ou segredos nos logs. Para cada caso: envio novo de Bob→Alice e Alice→Bob; destinatário em segundo plano/fechado por recentes; toque abre chat; duas mensagens rápidas; bloqueio em ambos sentidos; mute; opt-out/permissão Android negada; mensagem lida ou apagada; revogação entre reserva e envio; repetição do mesmo evento e falha/resultado FCM incerto. Distinguir aceitação FCM de chegada física e não confundir fechar por recentes com forçar parada. Medir latência sem prolongar prazo. Em caso negativo, confirmar que mensagem normal permanece disponível e que nenhuma notificação indevida foi recebida. Sem afirmar aprovação de casos não executados.

## Rollback e parada

Antes de qualquer futuro ensaio, capturar versão/deployment ativos e configuração, inclusive separação D1, sem segredos. Se houver custo inesperado, erro de identidade, envio indevido, excesso de CPU/cota ou duplicidade: interromper automação na flag independente e remover agendamento autorizado, preservar push manual, verificar ausência de novas reservas. Se necessário restaurar versão QA previamente confirmada mediante autorização, não assumir que rollback de código restaura dados. Nunca apagar marcador D1 ou reabrir claim/resultado incerto; preservar evidência e prazos. Nenhuma execução de rollback nesta etapa.

## Próxima ação concreta

Resolver fronteira real e IAM com auditoria somente leitura; se não houver evidência suficiente, interromper a rota Cron como não aprovada e avaliar alternativa gratuita. Não declarar implementação operacional concluída. Nenhum serviço pago, implantação, agendamento, IAM, segredo ou banco remoto alterado neste marco.
