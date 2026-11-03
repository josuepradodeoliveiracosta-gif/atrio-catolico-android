# Auditoria conservadora IAM/Cloud Run — somente leitura

**Uso futuro; não há implantação e nenhum recurso Google Cloud foi alterado.**

\`iam_audit.py\` recebe três arquivos JSON obtidos de uma sessão
administrativa autorizada, já existente: resposta **Cloud Run API v2
GET service**; política IAM **do serviço**; política IAM **do projeto**.
Nunca chama rede, gcloud, Google OAuth, SDK, Terraform, deploy,
Cloudinary, Firebase ou APIs de exclusão. Não contém segredos.

A ferramenta exige:
- mesmo projeto e nome do serviço privado;
- ingresso interno e exigência de IAM Invoker explicitamente ativa;
- invocador único, sendo conta de serviço distinta da leitora;
- runtime com conta leitora e **somente** os dois papéis diretos
  \`roles/datastore.viewer\` e \`roles/firebaseauth.viewer\`;
- instância única, concorrência 1 e imagem Artifact Registry fixada
  por SHA-256.

O relatório apresenta **apenas códigos de divergência**. Não publica
contas, membros, UIDs, políticas ou tokens. A saída \`status:
direct_snapshots_consistent\` confirma exclusivamente a correspondência
das políticas **diretas** dos snapshots; **não aprova uso em produção**.

Exemplo, após autorização para consultar a configuração e conservar
três snapshots em dispositivo privado fora do GitHub:

\`\`\`bash
python3 ops/cloud-run-private-review/iam_audit.py \
  --service-json /local/privado/cloudrun-service-v2.json \
  --service-iam-json /local/privado/cloudrun-service-iam.json \
  --project-iam-json /local/privado/project-iam.json \
  --caller conta-do-servico-chamador@atriocatolico.iam.gserviceaccount.com
\`\`\`

Não colocar as políticas em issues, CI pública, screenshots ou no
repositório. Um snapshot incompleto bloqueia o verificador, não produz
aprovação. A CI utiliza políticas fictícias e **nenhuma credencial**.

**Permanecem não verificados**: herança de organização e pastas,
grupos e identidades indiretas, IAM Deny, Principal Access Boundary,
tráfego destinado a revisões antigas, procedência da imagem, acesso
efetivo, rede do chamador, tratamento dos dados e privacidade. Logo
\`effectivePermissionsVerified\`, \`accountDeletionAuthorized\` e
\`googlePlayReleaseAuthorized\` são sempre \`false\`.

Referências oficiais:
- https://docs.cloud.google.com/run/docs/managing/services
- https://docs.cloud.google.com/sdk/gcloud/reference/run/services/get-iam-policy
- https://docs.cloud.google.com/sdk/gcloud/reference/projects/get-iam-policy
- https://docs.cloud.google.com/iam/docs/allow-policies
