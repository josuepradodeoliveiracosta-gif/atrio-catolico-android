# Push Automático 1.0 — marco 04A: fronteira do evento e desenho IAM

Base validada: CI 45868123298, commit bd152b672c92f756e1ee3da51d8f1b2af3ef239f.

Adaptador exclusivo de laboratório para a forma FirestoreEvent de onDocumentCreated (v2). Caminho literal do chat piloto e wildcard apenas do messageId; valida projeto físico demo, banco, tipo, documento, parâmetros e createTime. Não usa o conteúdo do evento. A transação relê a criação canônica e compara segundos/nanos, impedindo que um evento antigo autorize um documento recriado no mesmo caminho. Duplicidade de entrega não depende do CloudEvent id: recibo/outbox continuam usando chave canônica. Testes sintéticos de envelope contra Firestore/Auth emulados. Não é uma função registrada no Functions Emulator nem Eventarc real, não adiciona export em functions/index.js ou firebase.json.

## Identidades candidatas (não provisionadas)

- Trigger Eventarc: conta dedicada apenas à recepção de eventos e invocação do serviço específico. Candidatos roles/eventarc.eventReceiver e roles/run.invoker no alvo; validar necessidade, localização e agentes gerenciados do projeto.
- Runtime detector: identidade própria, sem chave JSON estática, sem capacidade de administrar admissões ou idade; autenticação entre serviços com ID token de audiência exclusiva. Preferir credencial do runtime via metadata server, verificar claims reais e compatibilidade da janela de 5 min.
- Publicador: fronteira privada separada, só operações restritas de aviso/outbox. Firestore Admin ignora Security Rules; permissões de dados IAM não garantem restrição por coleção/documento. Auditar blast radius real, avaliar papel customizado com operações mínimas e fronteira intermediária; não conceder Owner/Editor/Firebase Admin, nem assumir isolamento suficiente por convenção.
- Worker: manter identidade de envio atual e deduplicação compartilhada; futuro endpoint de serviço ainda não montado. Validar JWKS oficial, emissor, subject, email, audiência e expiração. Não reutilizar usuário operador manual nem tokens de Alice/Bob.
- Deployer: identidade humana/CI separada, autorização explícita e serviceAccountUser estritamente na conta prevista, nunca conceder tais privilégios ao runtime.

## Gate de pré-implantação
Inspecionar em leitura projeto atrio-catolico-qa-general, localização do banco (default), APIs ativas, billing/Blaze, serviços/contas existentes, IAM do projeto e contas, políticas herdadas e regras atuais; confirmar ausência de acessos a produção e de privilégios excessivos. Não registrar credenciais ou dados privados. Estimar custos de eventos, transações, invocações, egress e limites Worker. Confirmar flag de corte, janela original sem extensão, política de pendência ativa e retentativas limitadas antes de claim; hoje defer não tem agendador e pode expirar sem aviso. Resultado ambíguo pós-claim nunca é repetido. Definir retenção/outbox e rollback.

Referências oficiais:
- https://firebase.google.com/docs/functions/firestore-events
- https://firebase.google.com/docs/functions/retries
- https://docs.cloud.google.com/eventarc/standard/docs/functions/roles-permissions
- https://docs.cloud.google.com/iam/docs/roles-permissions/firestore
- https://docs.cloud.google.com/docs/authentication/get-id-token

A auditoria IAM real não foi executada: sem consulta autenticada de políticas Google Cloud nesta etapa. Nenhuma conta criada, role concedida, API habilitada, função registrada, Worker alterado ou implantação. Próximo gate: CI 04A, resolver defer/retentativa e fronteira real de identidade antes de considerar autorização de ativação.
