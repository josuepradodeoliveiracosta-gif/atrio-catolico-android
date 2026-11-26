# Marco 2 — coletores administrativos QA (somente leitura)

Implementação inicial de sondas de metadados, sem agendamento ou credenciais no CI.
As rotas são fixas. Não são consultados documentos, usuários, mensagens FCM,
logs de Workers ou código publicado. Não há envio de notificações, deploy, escrita,
criação de recursos, alteração de IAM ou autenticação de usuários.

| Variante | Firebase (gate existente) | Worker (candidato versionado) |
|---|---|---|
| perfil_qa | atrio-catolico-qa-perfil | não definido |
| chat_qa | atrio-catolico-qa-geral | atrio-qa-geral |
| qa_geral | atrio-catolico-qa-general | atrio-push-qa-general |

O nome de Worker é fixado pelo gerador chat-qa-build.mjs e pelo modelo
wrangler.qa-geral.example.toml, respectivamente; presença remota não comprovada.
O operador deve confirmar previamente a conta Cloudflare correta e usar token
de leitura restrito ao Worker QA. Não usar credenciais de produção. O ID de conta
é fornecido no ambiente, validado sintaticamente, não comprovado pelo script.
Firebase requer token OAuth já disponível, com permissão mínima de metadados
datastore.databases.get, limitado ao projeto QA. Nenhum token é criado pelo script.
Não fornecer tokens em argumentos, logs, repositório ou chat.

Exemplo local, com ATRIO_QA_FIREBASE_READ_TOKEN já definido privadamente:
```sh
python3 -m scripts.qa_service_diagnostics --environment perfil_qa --provider firebase \
  --confirm-target atrio-catolico-qa-perfil --output /tmp/perfil-metadata.json
```

Cloudflare: definir ATRIO_QA_CLOUDFLARE_ACCOUNT_ID e
ATRIO_QA_CLOUDFLARE_READ_TOKEN no ambiente privado, após confirmação da conta.
```sh
python3 -m scripts.qa_service_diagnostics --environment chat_qa --provider cloudflare \
  --confirm-target atrio-qa-geral --output /tmp/chat-worker-metadata.json
```

Importar recibos locais no relatório central:
```sh
python3 -m scripts.operational_diagnostic_center --ci-report ci-report.json \
  --qa-receipt /tmp/perfil-metadata.json --qa-receipt /tmp/chat-worker-metadata.json \
  --json /tmp/central-qa.json --markdown /tmp/central-qa.md
```

Uma consulta GET por execução, limite de resposta 500 KB, timeout 10 s de socket,
sem redirecionamento. Respostas brutas não são publicadas; erros são enums.
O resultado metadata_confirmed só comprova a leitura dos metadados esperados,
não tráfego, regras Firestore, FCM, disponibilidade, saúde ou autenticação.
403/401 e 404 não provam indisponibilidade do serviço; ausência de deploy
também não equivale a falha em runtime. Recibos importados não são assinados,
ficam rotulados como não verificados, separados da saúde operacional e expiram
em 24 horas. Sem credencial, não há requisição. A sondagem de FCM e Auth continua
pendente; não será simulada por status Firestore. Nenhuma configuração externa
foi modificada e nenhuma consulta real foi executada durante a implementação.

Referências de API:
- https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/get
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/

Validação offline: python3 -m unittest scripts.test_qa_service_diagnostics -v.
Homologar cada destino com operador autorizado antes de agendar qualquer coleta.
