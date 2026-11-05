# Homologação de e-mail: proteção de implantação Cloudflare

**Situação (05/11/2026):** versões produtivas `atrio-push` e `atrio-avatares` anteriores à PR #135. Não ativar `app_config/email_verification` nem liberar APK Release até a homologação integrada.

## 1. Divergência de configuração — bloqueio de deploy direto

Leitura **somente de metadados** da API Cloudflare confirmou:

| Binding/flag | No Worker `atrio-push` ativo | Em `cloudflare/push-worker/wrangler.toml` |
| --- | --- | --- |
| `PUSH_ENABLED` | `true` | `false` |
| `GUARDIAO_ENABLED` | `true` | `false` |
| `BROADCAST_ENABLED` | `true` | ausente |
| `QA_MANUAL_ENABLED` | `true` | ausente |
| `TEST_BOTS_ENABLED` | `false` | ausente |
| `GUARDIAO_AI_ENABLED` | `false` | `false` |
| `GUARDIAO_AUTOHIDE_ENABLED` | `false` | ausente |

O arquivo `wrangler.toml` não é espelho do ambiente produtivo. **Proibido executar um `wrangler deploy` convencional usando essa configuração sem reconciliar os bindings.** Fazer isso pode desativar push, broadcast, QA ou o Guardião. O Worker de avatar também tem segredos e binding D1 que precisam ser preservados.

Nunca adicionar valores de segredos, chaves Firebase, dados dos bancos D1 ou JSON de Service Account ao GitHub. Uma implantação autorizada deve preservar os nomes, tipos e referências de bindings, os secrets já configurados e os gatilhos/rotas e garantir que nenhum parâmetro de segurança seja rebaixado.

## 2. Build sem publicação

A CI `.github/workflows/worker-bundle-dry-run-ci.yml` executa `wrangler deploy --dry-run --outdir` para ambos os Workers **sem token Cloudflare**. Isso verifica a compilação/bundle do módulo compartilhado de confirmação de e-mail, mas **não carrega nenhum script ou configuração na Cloudflare**.

É um teste de empacotamento, não substitui verificações de endpoint com sessões Firebase verdadeiras.

## 3. Ordem obrigatória antes da ativação

1. Comparar a release Firestore realmente publicada com `firestore.rules` da `main`. Usar auditoria read-only existente e não imprimir token.
2. Se as regras estiverem desatualizadas, fazer deploy por procedimento autorizado e verificar a implantação. **Manter a política de e-mail desativada.**
3. Registrar a configuração atual dos Workers sem ler valores secretos, preparar rollback e implantação versionada que preserve os bindings e a disponibilidade de push/Guardião.
4. Implantar e validar `atrio-avatares` e `atrio-push` atualizados (PR #135), **ainda com a política desativada**.
5. Validar com sessão Firebase de teste que o acesso aos endpoints e notificações continua funcionando, sem exposição de dados.
6. Ativar administrativamente a política `enabled=true`, `version=2026-11-v1` e confirmar essa alteração por leitura autenticada.
7. Testar com conta de QA não verificada (bloqueio de UI, Firestore SDK e chamadas HTTP Workers) e conta verificada (acesso após `reload()` / renovação do token). Verificar quedas de conexão, logout e retomada da sessão.
8. Registrar aceite com evidências sem PII. **Somente após tudo isso** considerar a aprovação da assinatura de Release.

**Não executar rollback isolado de Workers com a política ainda ativa**, pois código antigo permitiria contornar a verificação; rollback exige coordenação de regra, flag e versões.

## 4. Inspeção pelo Termux sem plugin Firebase

O Termux já possui Firebase CLI autenticado e uma auditoria anterior em `~/atrio-limpeza/auditar_email_atrio.js`. **Não reexecutar automaticamente esse script**: a auditoria anterior também salvou uma cópia local das regras e não foi comprovado que uma nova execução não alteraria um arquivo de backup. O backup está protegido pela orientação expressa do responsável.

Uma rotina nova, auditável e sem gravação foi acrescentada em `scripts/termux-email-production-readonly.mjs`. Ela aproveita a **sessão existente de login do Firebase CLI global**, sem executar `firebase login`, sem depender de `gcloud`, sem exportar tokens e sem abrir o script anterior de backup. Deve ser executada somente após integrar e atualizar o repositório e com **Node 22+**:

```sh
# A partir da raiz da cópia atualizada do repositório Átrio Católico:
node scripts/termux-email-production-readonly.mjs
```

O programa consulta as mesmas três rotas HTTP `GET` do preflight auditado, usando o token renovado **em memória** pelo `firebase-tools` local; não executa gravações nem cria arquivos ou backups. Não é necessário informar ou copiar uma credencial para o chat.

Em caso de `atrio_termux_preflight_firebase_cli_incompatible`, o Firebase CLI local utiliza uma estrutura interna diferente: abortar e revisar a compatibilidade, sem tentar extrair o token do arquivo de login. Caso apareça `firebase_login_unavailable` ou `permission_denied`, não executar um deploy para contornar o erro; conferir a autenticação e as permissões. Mensagens `ready: false`, `emailPolicy.state: DISABLED` ou `MISSING` são esperadas antes da ativação: significam que **não é permitido autorizar Release**, não que a auditoria tenha alterado o estado do Firebase.

O preflight alternativo `scripts/email-verification-production-preflight.mjs` ainda aceita um OAuth token disponibilizado por ambiente Google autorizado, se necessário. Nenhum dos auditores realiza deploy. Nunca colar credenciais ou tokens na conversa. Até conferir as regras publicadas e a política real, manter o estado do Firebase como **não homologado** e o Release bloqueado.

## 5. Comparação de mudanças antes de publicar regras Firestore

O primeiro preflight autenticado no Termux identificou uma divergência entre as regras publicadas e `firestore.rules` da `main`. Também confirmou que o documento de política de e-mail está **ausente**. Não é seguro substituir as regras produtivas somente porque a versão local passou no Firebase Emulator: pode haver ajustes exclusivos de produção.

A rotina `scripts/termux-firestore-rules-diff-readonly.mjs` utiliza o login existente do Firebase CLI e realiza **exatamente duas requisições GET**, à release `cloud.firestore` e ao ruleset publicado. Toda comparação das regras é feita em memória, sem salvar snapshots, alterar o backup nem revelar tokens ou o conteúdo completo das regras.

Execute **na cópia separada do repositório**, já criada no Termux como `~/atrio-auditoria`:

```sh
cd ~/atrio-auditoria
git pull --ff-only origin main
node scripts/termux-firestore-rules-diff-readonly.mjs
```

`git pull` atualiza exclusivamente essa cópia de trabalho; não execute o comando dentro da pasta de backup. O script imprime SHA-256, contagens e **trechos limitados** das regiões diferentes, incluindo declarações `match` e `function` que existirem apenas de um lado. Não executa `firebase deploy` e não grava arquivos. Se o CLI mudar ou o acesso falhar, aborta sem ação alternativa.

É fundamental examinar declarações exclusivas de produção antes de avançar. O relatório de diferenças **não constitui autorização de implantação**. Qualquer implantação de regras deve ter controle explícito sobre as diferenças, política administrativa inicialmente desativada e verificação posterior. Enquanto a homologação não for comprovada, a assinatura APK Release permanece bloqueada.


## 6. Revisão final de linhas exclusivamente produtivas

O diagnóstico de 05/11/2026 detectou **33 regiões diferentes, 31 linhas exclusivas das regras publicadas e 138 linhas exclusivas da versão do GitHub**. O resumo de 16 regiões omite outras 17. Uma declaração antiga `emailVerificationAllowsPublishing` aparece só na produção, mas somente essa constatação não é suficiente para garantir que toda a diferença seja segura.

O relatório complementar **somente leitura**, `scripts/termux-firestore-production-only-readonly.mjs`, lista apenas as linhas que estavam na produção mas não existem na versão do repositório, com números e texto estrutural abreviado. Comentários, trechos longos e possíveis segredos são omitidos. O comando usa a mesma sessão existente do Firebase CLI, consulta apenas release/ruleset via **dois GET**, sem criar snapshot, backup, arquivo ou executar deploy.

Na cópia de auditoria já existente:

```sh
cd ~/atrio-auditoria
git pull --ff-only origin main
node scripts/termux-firestore-production-only-readonly.mjs
```

O resultado deve ser revisado por quem controla o projeto antes de substituir regras. `deploymentApproved` e `releaseApproved` permanecem **false**, mesmo se todas as linhas antigas forem explicáveis. Não substituir regras do Firebase nem ativar a política de e-mail durante a análise.


## 7. Implantação protegida apenas de regras Firestore

**Conclusão da comparação de 05/11/2026:** as 31 linhas exclusivas da produção correspondem principalmente à função antiga do portão de e-mail, permissões anteriores e comentários/posicionamento. A coleção app_config/engagement também existe no repositório. A versão no GitHub passou nos testes do Firebase Emulator. Isso não substitui a verificação de que o ruleset publicado continua intacto no momento do deploy.

A rotina scripts/termux-firestore-rules-guarded-deploy.mjs **só permite alterar as regras** se:
- O SHA-256 das regras publicadas ainda for 9c7678a7dfbadececb30d5f770a25fb81c6f5926fedafc75e303c7e3bb3e6a02 (auditoria real);
- O SHA-256 das regras locais ainda for 4b479daa1d4d8673c3e1e9f70a2f9d752e7df996d414aefa1397ad86661bd76e;
- A política de confirmação de e-mail estiver MISSING e a de consentimento comunitário não estiver ativa;
- Uma segunda leitura logo antes do deploy ainda confirmar as mesmas pré-condições;
- A execução do Firebase CLI se limitar a firestore:rules no projeto atrio-catolico, sem implantar Cloudflare, documentos ou APK.

O comando assume a sessão já autenticada no Firebase CLI do Termux. Use **somente a cópia de trabalho** ~/atrio-auditoria, nunca o backup original. Inspeção somente leitura (modo padrão):

    cd ~/atrio-auditoria
    git pull --ff-only origin main
    node scripts/termux-firestore-rules-guarded-deploy.mjs

Somente depois de conferir canApplyRules: true, emailPolicy: MISSING, o hash publicado antigo e a política de consentimento não ativa, o comando para publicar **apenas regras de produção** é:

    node scripts/termux-firestore-rules-guarded-deploy.mjs --apply

**ATENÇÃO: a segunda execução altera as regras Firestore produtivas.** Ela não cria/sobrescreve backups, não modifica documentos, não ativa a exigência de confirmação, não muda Workers e não libera APK Release. Se alguma pré-condição falhar, o comando aborta antes do deploy. Se a CLI falhar durante a implantação ou a validação posterior divergir, não repetir automaticamente; inspecionar o estado real.

Após o deploy, a auditoria original deverá apresentar regras iguais às da main, mas emailPolicy: MISSING e ready: false. Isso é esperado: a obrigatoriedade só será ativada depois da atualização e homologação dos Workers e dos testes reais. Nenhuma regra é autorizada como Release por essa etapa.
