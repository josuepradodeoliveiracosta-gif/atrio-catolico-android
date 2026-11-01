# Portal web de exclusão — integração de QA para Play (PR #71)

**Preparação de código; nenhuma implantação ou processamento real de exclusão.**

## Arquivos e isolamento

O portal estático em `cloudflare/account-deletion-portal/` foi integrado seletivamente da PR #98.
A build `node cloudflare/account-deletion-portal/scripts/build.mjs` exige os quatro
metadados públicos do Firebase Web corretos, mas **mantém hard-coded**
`LIVE_INTAKE_REVIEWED_AND_APPROVED=false`, `intakeEnabled=false` e
`actualDeletionEnabled=false`. Variáveis de ambiente **não** ativam o formulário.
Não passar segredos de Admin SDK, tokens ou senhas para o build.

Os testes `npm --prefix cloudflare/account-deletion-portal test` executam
somente com fixtures e verificam a trava, a ausência de exclusão, o domínio Firebase,
o cabeçalho CSP, anti-clickjacking e o destino de Hosting isolado.
O CI unsigned AAB executa esses testes **antes de usar o Android SDK**.
Nenhum workflow desta branch implanta o portal.

O alvo dedicado `atrio-catolico-exclusao` está declarado **somente** no arquivo
`cloudflare/account-deletion-portal/.firebaserc`. O arquivo
`firebase.hosting.proposed.json` não altera `firebase.json` da raiz nem
faz deploy. O cadastro do site é relatado no histórico da PR #98; sua existência,
conteúdo público e configuração atual precisam de verificação independente.

## Auditoria read-only pelo Termux

No checkout desta branch (`feature/play-closed-testing-aab-20261031`):

```bash
node cloudflare/account-deletion-portal/scripts/termux-web-preflight.mjs
node cloudflare/account-deletion-portal/scripts/termux-hosting-target-preflight.mjs
```

Esses comandos só consultam Firebase CLI, validam o destino do site reservado
e geram um build temporário, sem imprimir a configuração Web. **Não execute**
`firebase deploy`, `firebase target:apply` ou `firebase hosting:channel:deploy`
por causa desta integração. Não publicar páginas ou pedir dados do usuário sem
executor real, política de retenção, política de privacidade e revisão de segurança.

## Bloqueios de distribuição

- A solicitação autenticada no Android já está integrada, mas **não exclui dados**.
- O formulário web está **desabilitado**; a existência do código não equivale a portal HTTPS funcional.
- O executor (Auth/Firestore/Cloudinary/FCM), política de retenção e tratamento dos pedidos
  seguem em revisão na PR #98; nenhum deploy ou migração foi autorizado.
- Evidências `external_portal`, `deletion_executor` e demais controles continuam
  `verified:false`; `releaseAuthorized:false` continua imutável até homologação.
- O AAB unsigned passa nos testes de build, mas **não** autoriza assinatura ou upload.
