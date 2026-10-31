# Publicação controlada do gateway V2 (31/10/2026)

## Situação observada

- Worker Cloudflare `atrio-guardian-v2` implantado na conta `atrio-catolico` e com domínio `https://atrio-guardian-v2.atrio-catolico.workers.dev`.
- Worker lê status e casos administrativos usando Firebase ID token e as Security Rules do Firestore; não possui conta de serviço nem chave JSON.
- Código preparado para `POST /admin/resolve` com ações `dismiss` ou `acknowledge`, gravando caso + auditoria + aviso e verificando versão de origem no mesmo commit.
- Proteção em produção: `GUARDIAN_V2_ADMIN_WRITES_ENABLED=true` foi habilitada na Cloudflare em 31/10/2026 após a publicação das regras; o comportamento ponta a ponta ainda não foi comprovado por testes.
- `firestore.rules` desta branch implementa autorização administrativa e validação cruzada via `getAfter`; o usuário publicou as regras em 31/10/2026 com resultado `Deploy complete!` no Google Cloud Shell.
- Build do candidato 0.20.0 fixa o endereço conhecido do Worker e preserva a assinatura atual. Flag separada `ATRIO_GUARDIAN_V2_RELEASE_APPROVED` continua necessária para assinar o APK.

## Plano de implantação e reversibilidade

1. Preserve a versão atual das regras: faça cópia do conjunto publicado de Security Rules e identifique o ruleset vigente no Firebase Console, na área de Rules/Histórico.
2. No Google Cloud Shell, use a branch `release/atrio-v0.20.0-guardian-v2-prep-20261031` no SHA que contém esta documentação. Não use a `main` antiga; ela não contém as novas regras.
3. Publique **somente** Firestore Rules (não índices, não Storage) após conferência da alteração: `firebase deploy --project atrio-catolico --only firestore:rules`. A publicação depende da conta autenticada no Firebase CLI e da permissão de edição de Rules.
4. Mantenha o Worker em escrita desativada até verificar a publicação e a possibilidade de voltar ao ruleset anterior. Isso é especialmente importante porque as regras protegidas por `getAfter` controlam autorizações de lote.
5. Concluído em 31/10/2026: `GUARDIAN_V2_ADMIN_WRITES_ENABLED=true`, confirmado por leitura de configuração da Cloudflare. Não conceder token de serviço ao Worker nem habilitar ações de exclusão nele.
6. Em caso de anomalia, volte a variável Cloudflare para `false` imediatamente e reverta as Firestore Rules usando o ruleset salvo. Nenhuma remoção de conteúdo faz parte desse gateway.
7. Integre a branch à `main` em revisão separada e configure a aprovação do release assinado. O APK não foi gerado nesta etapa.

**Atenção:** ainda falta provisionar a identidade WIF de escrita separada para execução automática de criação de casos; o gateway Cloudflare aqui é administrativo e não substitui o executor. Nenhuma classificação real ou resolução administrativa foi testada após a publicação, por solicitação do usuário. A moderação autônoma punitiva e banimentos permanecem indisponíveis.

## Identidade WIF de escrita — confirmação de infraestrutura

Em 31/10/2026, o proprietário apresentou resultados do Google Cloud Shell:

- Conta `guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com` existe.
- Provedor WIF dedicado `github-moderator` no pool `guardian-v2-writer` em estado `ACTIVE`.
- Role personalizada de cinco permissões sem `datastore.entities.delete` foi atribuída com a saída `PAPEL_IAM_V2_ATRIBUIDO`.

Esta evidência confirma o provisionamento de infraestrutura. **Não comprova que o workflow GitHub já conseguiu trocar o OIDC por credenciais**, nem que tenha criado casos em produção. O agendamento de escrita está ausente da `main` e o documento `guardian_config/policy` ainda precisa conter `autonomousWriteEnabled=true` para permitir triagem. Não habilitar variáveis do GitHub nem abrir escrita autônoma antes da integração revisada.

Para respeitar a orientação de não executar novas baterias de testes, mudanças de código permanecem somente nesta branch. A integração na `main` acionaria workflows existentes de compilação e verificação, de modo que seu efeito precisa ser considerado antes do merge. O backup não foi alterado.
