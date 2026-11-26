# Push Automático 1.0 — marco 05A: inventário pré-implantação

CI 45869384384 aprovada. Auditoria Cloudflare realizada em leitura em 26/11/2026:
- Worker atrio-push-qa-general localizado, última modificação informada 25/11/2026 23:51:47 UTC.
- Bindings QA_PUSH_ENABLED=true e QA_CONVERSATION_PUSH_ENABLED=true. O código wrapper candidato usa essas flags, não existe binding independente de automatização observado. QA_CONVERSATIONS_API_ENABLED não observado na listagem.
- QA_PUSH_DB aponta para atrio-push-qa-general-delivery, UUID correspondente ao manifesto QA já registrado; D1 listado na conta e diferente do binding de produção (comparação somente metadados).
- QA_FIREBASE_SERVICE_ACCOUNT_JSON e QA_FIREBASE_WEB_API_KEY existem como secret_text; não foram lidos valores. Observabilidade habilitada. Configuração remota informada: compatibility_date 2026-10-26, compatibility_flags vazia. Não afirmar equivalência de código implantado com o candidato.
- Deployment listado: af89cc1b-2ef9-443a-a38d-e60673b2ad17, versão 6fcc1921-05da-4395-ae36-b8215eff8d1b, 100% nesse registro. Confirmar deployment efetivamente ativo antes de rollback.
- Não foi executada consulta SQL remota, emissão de FCM, deploy, alteração de binding ou secret.

Google Cloud não disponível por conector autenticado nesta sessão. Script de inventário local usa ADC já configurada, projeto fixo, GET e getIamPolicy (POST de leitura), sem listar conteúdo de chats, segredos, tokens ou membros IAM. Retorna somente metadados, roles, contagens, erros HTTP. Não constitui prova de IAM efetivo: herança, grupos, políticas condicionais, negações, acesso cross-project e identidade real do secret Worker precisam de auditoria adicional. Ausência de APIs na lista parcial não é ausência comprovada. Não cria conta, habilita API, concede role ou altera dados.

Gate: executar localmente em tests/security com dependências existentes, revisar saída antes de ativação. Separar conta de serviço runtime, trigger e deployer; evitar chaves estáticas para o automatizador. Não habilitar nada por causa de 403. Avaliar papéis de leitura/escrita em Firestore (IAM não restringe por coleção), política de convivência manual/automática, configuração de flag independente na fronteira real, índices, custos, fila/retentativa, retenção e rollback. O código de laboratório não é implantável e a homologação remota permanece bloqueada.
