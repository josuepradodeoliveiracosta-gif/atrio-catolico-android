# Push Automático 1.0 — 07C: matriz de privilégio mínimo

CI 45878708063 concluída com sucesso. Workers Free confirmado pelo fundador. Evidência local de 26/11/2026: conta de serviço dedicada ao push QA identificada por gcloud; política do projeto atribui diretamente AtrioQaPushAuthReader, roles/datastore.viewer e roles/firebasecloudmessaging.admin, sem condição, sem grupos ou membros públicos observados. Consulta gcloud da definição AtrioQaPushAuthReader retornou apenas firebaseauth.users.get. O auditor ADC retornou 403 para billing, metadados da conta/chaves, política da conta e definições dos papéis; não confundir esse resultado com ausência de acesso. Vínculo efetivo do secret Worker à identidade, acesso cross-project, denies e permissões efetivas não comprovados.

## Decisão de arquitetura (proposta, não autorização)

Preservar conta de envio existente e seus três papéis. Não atribuir roles/editor, roles/owner, roles/datastore.user ou datastore.entities.delete à identidade de publicação. Propor identidade de serviço separada, exclusiva do QA, com papel personalizado contendo somente:
- datastore.databases.get — beginTransaction/rollback
- datastore.entities.get — batchGet e leituras de transação
- datastore.entities.list — consulta limitada de dispositivos
- datastore.entities.create — pending ausente, receipt e outbox
- datastore.entities.update — pending existente, claim e finish
- firebaseauth.users.get — verificação bilateral de contas

A identidade de publicação não necessita enviar FCM, modificar usuários, gerenciar IAM, criar chaves, índices, bancos ou apagar documentos. A identidade de envio permanece separada e deve receber somente trabalho confirmado e revalidado. Não criar conta, papel, vínculo IAM, chave ou secret neste marco. A composição laboratorial ainda não implementa separação efetiva de credenciais. Não reutilizar a conta de envio como escritor.

Fonte oficial: https://docs.cloud.google.com/firestore/native/docs/security/iam (métodos REST e permissões); https://firebase.google.com/docs/firestore/use-rest-api (OAuth de conta de serviço usa IAM e ignora Security Rules).

## Limite crítico de segurança

IAM Firestore não restringe o direito de escrita a uma coleção/documento individual. Mesmo o papel acima dá capacidade de criar/atualizar documentos fora das três rotas pretendidas dentro do banco autorizado. Não é isolamento por coleção e não é garantia de privilégio mínimo em termos de dados. Condição de banco QA e identidade exclusiva reduzem escopo, mas não resolvem esse risco. O plano permanece NO-GO até revisão explícita desse risco e implementação de fronteira estrita de escrita (allowlist de rotas, campos, máscaras, precondições, estados e transação; nenhuma entrada de caminho/UID do cliente), sem confundir a allowlist de código com controle IAM. Considerar alternativa sem credencial de escrita administrativa caso o risco residual seja inaceitável. Não mudar Security Rules para contornar IAM. Não criar segundo banco faturável.

## Operações admitidas na fronteira futura

Publicação: pending de destinatário canônico do par fixo, receipt e outbox de chave derivada, criação única, expiry original e transação atômica. Claim: apenas outbox confirmado, estado/claimId + REQUEST_TIME claimedAt, precondição de versão. Finish: apenas state + REQUEST_TIME finishedAt, precondição de versão e claimId validado. Proibidos delete, writes de chat/mensagem, Auth updates e alterações de configuração/admissão/idade, mesmo se a conta IAM tivesse capacidade. A implementação de transporte de produção precisa usar credenciais separadas e não transportar tokens entre fronteiras.

## Próxima etapa

Implementar e testar o guard de escrita REST antes de qualquer discussão de concessão real. Avaliar identidade/credenciais sem chave permanente, uso compartilhado e CPU do Workers Free. Nenhum deploy, Cron, IAM, billing ou serviço pago autorizado. Homologação física pendente.