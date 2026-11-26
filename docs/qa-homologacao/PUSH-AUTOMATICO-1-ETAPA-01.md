# Push Automático 1.0 — etapa 01 (QA isolado)

Base: APK 46 / f25d339f2ddca75c07677cd700cdb6daf069ea85. Correção temporal e protocolo GET /notice intactos.
O cenário principal, recentes e mensagens consecutivas foram relatados como aprovados no aparelho; tela bloqueada e sentido inverso adiados, permissão negada inconclusiva. Não há homologação integral.

## Decisão e limites
- Novo gatilho somente de criação canônica no chat fictício, com projeto, banco, caminho e identidade de runtime fixados. Eventos duplicados ou fora de ordem são esperados.
- Contrato puro de decisão, fechado por padrão. O snapshot normalizado é responsabilidade de um futuro adaptador autenticado; nunca confiar em dados do evento/cliente para autor, destinatário, idade ou estado. Tempo de servidor; precisão de ms conservadora e limite de 120 s desde criação, não renovável.
- Preservar publicação transacional existente e revalidação do Worker, incluindo bloqueios, admissões, elegibilidade, sessão Auth atual, silêncio, não lido, mensagem canônica, dispositivo e deduplicação.
- A pendência única atual não pode ser sobrescrita enquanto ativa. Adiar com limite original, reler estado e descartar se obsoleto; revisar política de coalescência antes de ativar. Não presumir uma notificação por mensagem rápida.
- Recibo existente nunca recria pendência. A etapa de outbox precisa resolver publicação seguida de falha de transporte, reserva D1 e resultado FCM desconhecido; não prometer exactly-once entre sistemas.
- O resultado candidate é apenas uma intenção local, não uma autorização e não executa escrita, publicação ou FCM.

## Fronteiras de identidade ainda a validar
1. Runtime dedicado no QA, sem chave estática, usuário Firebase operador continua desativado; não representar Alice/Bob.
2. Identidade do gatilho separada do publicador e da interface administrativa. Somente capacidade de publicação via código restrito; não conceder manage_admissions, gestão etária, Auth admin ou deploy.
3. Firestore Admin SDK ignora Rules. IAM pode não limitar escrita por documento; não alegar isolamento por coleção sem verificar. Avaliar serviço intermediário restrito e separação de recursos. Revisar IAM real em leitura antes de qualquer concessão.
4. Entrada Worker de serviço separada do POST /event existente: validar credencial curta, emissor, audiência, identidade, validade, replay e projeto; nunca aceitar identidade afirmada pelo cliente. Reusar verificações e reserva D1, não introduzir rota de envio direto sem elas.
5. Flag independente desligada por padrão no publicador e no Worker; revogação imediata; nenhuma mudança em Rules, IAM, Worker ou infraestrutura nesta etapa. Sem deploy, segredos ou chamadas externas nos testes.

## Gates
- Etapa 01: decisão pura + testes sintéticos; revisão de CI.
- Etapa 02: adaptador de leitura consistente e publicação/outbox transacional no emulador, com corrida de revogação, mensagens rápidas e falhas.
- Etapa 03: autenticação de serviço e contrato Worker em laboratório, sem FCM real.
- Etapa 04: auditoria IAM, custos, infraestrutura, kill switch e rollback; autorização explícita antes de implantação QA.
- Etapa 05: homologação física com APK 46 se compatível, sem Debian por mensagem; somente depois considerar APK novo ou expansão.
