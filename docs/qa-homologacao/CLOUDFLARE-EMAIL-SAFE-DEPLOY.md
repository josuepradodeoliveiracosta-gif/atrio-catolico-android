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

O Termux já possui Firebase CLI autenticado e uma auditoria existente `~/atrio-limpeza/auditar_email_atrio.js`, criada no fluxo anterior. Reexecutar somente a leitura, jamais um comando de escrita sem a verificação de diferenças e autorização da implantação:

```sh
cd ~/atrio-limpeza
node auditar_email_atrio.js
```

Se o script apresentar informações privadas, ocultá-las antes de compartilhar o resultado. Este documento não pressupõe que `gcloud` esteja instalado no Termux. O preflight separado `scripts/email-verification-production-preflight.mjs` exige um OAuth token Google com permissão de leitura e não precisa ser usado se a auditoria existente continuar disponível.
