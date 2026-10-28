# Preparação para abrir o repositório

## Estado: NÃO LIBERADO para publicação

Revisão de 28/10/2026. A visibilidade permanece privada. Este documento é um
registro de evidências e pendências, não uma certificação de ausência de falhas.
As alterações desta proposta precisam ser integradas e validadas antes da abertura.

### Escopo examinado

- `main`: `3b4a8a85bba77dc0a1f06e6e9a8578dd07094e60`.
- Desenvolvimento 0.19: `597e8cfb2194bc71f1457e136d75901a210e3b6e`.
- 22 branches, 361 commits distintos, 345 árvores e 456 blobs de texto distintos.
- As três referências de merge de PR adicionais não acrescentaram blobs de texto.
- A consulta de referências não retornou tags; a consulta de releases retornou vazia.
- Um vídeo MP4 histórico foi identificado por nome/tamanho, sem inspeção do seu
  conteúdo ou metadados. Confirmar direitos de publicação e ausência de dados pessoais.
- Varredura por padrões de tokens GitHub/AWS/Google OAuth/Slack, JWTs literais,
  material de chave privada, JSON de conta de serviço e nomes de arquivos sensíveis.
  Nenhuma ocorrência real nesses padrões. Não equivale a detectar todo tipo de segredo.
- Marcadores PEM encontrados pertencem ao parser ou a chaves geradas durante testes.
  `google-services.json` contém configuração de cliente Firebase, não credencial admin.
- Identificadas 804 execuções antigas de Actions. Logs e artefatos NÃO foram
  integralmente examinados; isso bloqueia a liberação. Comentários de revisão,
  anexos, caches e metadados de commits também exigem avaliação de privacidade.
- Não foi verificado o estado implantado das regras Firebase, IAM, App Check,
  restrições das API keys, segredos, proteção da conta ou configuração Cloudflare.

### Proteções preparadas no código

1. Actions fixadas em SHAs completos consultados nos repositórios de origem.
2. Checkout sem persistir credenciais; token dos workflows com leitura mínima.
3. Compilação assinada limitada ao repositório original e à branch `main`, com
   ambiente `release-signing` e variável de habilitação explícita.
4. Na proposta para 0.19, QA de produção limitada à `main`, ambiente `production-qa`,
   disparo manual e habilitação explícita. O verificador do APK não recebe senhas dos bots.
5. `.gitignore` reforçado, CODEOWNERS, política de segurança e Dependabot.
6. Detector complementar de segredos em arquivos e histórico, sem imprimir valores.

O detector é simples e não substitui secret scanning do GitHub ou revisão manual.
CODEOWNERS não obriga aprovação sozinho: configurar regras no servidor.
As proteções novas não tornam inofensivos workflows antigos executados em branches
antigas. Não disparar essas versões com segredos de repositório disponíveis.

## Procedimento antes de mudar a visibilidade

### 1. Conta e acesso

- Ativar 2FA/passkey; guardar códigos de recuperação fora do repositório.
- Revisar colaboradores, GitHub Apps, deploy keys e tokens; remover acessos não usados.
- Manter backup privado da chave Android e senhas. Não rotacionar a chave de assinatura
  por rotina: a compatibilidade de atualização depende dela.

### 2. Segredos e ambientes — obrigatório antes de habilitar builds

Em Settings → Environments criar `release-signing` e `production-qa`.
Restringir deployment branches à branch `main` exata, sem tags ou branches de PR.
Quando houver outro mantenedor confiável e o plano permitir, exigir sua revisão.
Não configurar uma exigência de aprovação impossível de satisfazer numa conta solo.

Transferir os três secrets de assinatura para `release-signing`:
`ATRIO_KEYSTORE_BASE64`, `ATRIO_STORE_PASSWORD`, `ATRIO_KEY_PASSWORD`.
Transferir `ATRIO_QA_BOTS_JSON` para `production-qa`, se já existir.
Verificar as cópias protegidas antes de remover os mesmos secrets do nível do
repositório. Segredos de conta de serviço Firebase/Cloudflare não devem estar em
Actions de PR; manter apenas no serviço e processo administrativo necessários.

Só depois da migração e das restrições configuradas definir a variável de repositório
`ATRIO_RELEASE_ENABLED=true`. A proposta bloqueia a compilação do workflow de release
até isso ocorrer. Para QA de produção, manter `ATRIO_PRODUCTION_QA_ENABLED` ausente
ou `false` até aprovar a sessão e integrar o executor revisado à principal.
Não habilitar QA apenas para testar esta preparação.

Não basta criar um ambiente com um nome: sem restrições ele não protege os secrets.
Se o plano não disponibilizar a proteção necessária, manter os secrets fora do
GitHub e assinar por um processo local confiável até solucionar essa limitação.

### 3. Actions e branches

- Settings → Actions → General: token com leitura; desativar criação/aprovação de PRs
  por Actions; exigir aprovação de workflows de todos os colaboradores externos.
- Usar runners hospedados efêmeros. Não conectar um runner pessoal com segredos a PRs.
- Proteger `main`: impedir exclusão e force push, exigir PR e verificações de segurança,
  versão e testes relevantes. Configurar revisões compatíveis com o número de mantenedores.
- Fixar Actions por SHA e revisar atualizações do Dependabot antes de integrar.
- Revisar mudanças em workflows, Gradle e scripts antes de qualquer build assinado:
  código de build também pode acessar os secrets fornecidos ao processo.
- A API informou que rulesets não estão disponíveis no plano privado atual. Resolver
  isso antes da abertura ou planejar uma transição controlada com Actions e segredos
  desabilitados até configurar as regras. Não assumir proteção ativada por este PR.

### 4. Histórico, logs e privacidade

- Revisar as 804 execuções e artefatos ainda retidos, sobretudo assinatura, testes
  reais, comandos administrativos e exports. Considerar que se tornarão acessíveis.
- Remover logs/artefatos sensíveis após preservar uma cópia privada necessária.
  A exclusão é destrutiva: identificar os itens antes de executar.
- Examinar autores/e-mails de commits, descrições de PR, comentários de revisão e anexos.
- Se algum segredo real aparecer, revogar/rotacionar primeiro; limpar o histórico
  sozinho não invalida a credencial. Reescrita de histórico exige plano específico,
  inclusive referências de PR e cópias existentes. Não reescrever o backup nesta proposta.
- Verificar o MP4 e seus direitos. Não foi acrescentada uma licença automaticamente:
  escolher conscientemente direitos de código, marca, imagens e vídeo antes de publicar.

### 5. Firebase e Cloudflare

- Conferir regras efetivamente implantadas e comparar com as regras revisadas.
- Testar no emulador: usuário sem login, usuário A acessando dados privados de B,
  autopromoção a admin/clero, escrita em tokens de outro usuário e moderação indevida.
- Revisar permissões da conta de serviço, quotas e alertas de consumo. Admin SDK
  ignora regras Firestore; endpoints do Worker precisam manter autorização própria.
- Restringir API keys às APIs necessárias. Validar restrições de aplicativo antes
  de ativá-las para não quebrar autenticação/serviços existentes.
- Avaliar App Check, proteção contra abuso e limites de requisição. Publicar o código
  não substitui essa proteção. Não ativar enforcement sem validar clientes existentes.
- Manter funcionalidades de QA desativadas fora de sessões autorizadas; nunca expor
  endpoint público que aceite comandos administrativos ou identidades escolhidas pelo cliente.

### 6. Validação e abertura

- Integrar primeiro a proposta da principal; aplicar também a proteção na branch 0.19
  antes de integrar PR15. Resolver conflitos de workflow preservando todas as restrições.
- Executar os testes e uma compilação controlada após resolver o bloqueio de cobrança.
- Confirmar assinatura, applicationId e versionCode do APK. Esta preparação não altera
  nenhum deles, não produz APK nem comprova teste em aparelho.
- Ativar secret scanning, push protection, alertas de dependências e relato privado
  de vulnerabilidades conforme disponibilidade. Verificar a ativação real no painel.
- Somente após fechar as pendências: Settings → General → Danger Zone → Change visibility.
  Conferir novamente proteções e acesso de Actions imediatamente após a transição.

## Fontes oficiais

- https://docs.github.com/en/actions/reference/security/secure-use
- https://firebase.google.com/docs/projects/api-keys
- https://firebase.google.com/support/guides/security-checklist
