# Átrio Católico — Etapa 2: distribuição oficial pelo GitHub Releases

Preparação em 31/10/2026. **Proposta isolada, não publicada**. Esta PR depende dos verificadores da Etapa 1, PR #65. Não ativa atualizações no aplicativo, não instala APK, não modifica Firebase/Cloudflare ou a chave permanente e não altera o backup.

## Resultado planejado

Somente após **aprovação manual**, um GitHub Release público e estável contendo:

- `atrio-catolico.apk`: o APK *release* já compilado e assinado, renomeado sem alterar seus bytes.
- `update.json`: manifesto com pacote, versão, código da versão, SHA-256 do APK, tamanho, URL HTTPS oficial, certificado esperado para referência e notas. O fingerprint publicado **não substitui** o certificado confiável embutido no futuro app.
- `SHA256SUMS.txt`: verificações SHA-256 do APK e do manifesto.

Exemplo de endereço futuro (ainda não existe): 
`https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/download/v0.20.0/update.json`.
O aplicativo futuro deverá consultar a **última versão estável publicada** via API pública do GitHub e então buscar o manifesto. Não confundir URL de uma versão fixa com ponteiro de atualização.

## Segurança implementada na preparação

1. Workflow **somente manual** `.github/workflows/ota-publish-release.yml`; bloqueado fora da `main` e em reexecução.
2. Modo `validate` por padrão: permissão de leitura e **não publica**.
3. Publicação exige modo `publish` e frase exata `PUBLICAR ATRIO`. O único job com `contents: write` só roda após validação.
4. Aceita APK assinado do workflow manual `build-apk.yml`, produzido na `main`; única exceção é o run #41174393714 da versão 0.20.0, com SHA e workflow explicitamente fixados.
5. Confere integridade de artefato, commit de origem ancestral à `main`, metadata Gradle nesse commit, pacote oficial, versão, APK não depurável, certificado previamente confiável e SHA-256 do APK **fornecido pelo responsável**.
6. Proíbe versões estáveis mais antigas ou iguais e impede reutilizar tag existente. Uma publicação fica primeiro em rascunho; confere os três arquivos antes de torná-la visível.
7. Não recompila nem reassina arquivos no fluxo de publicação. Nada lê o JKS nem solicita senha.
8. Não envia atualizações obrigatórias: `mandatory: false`.

## Como validar sem publicar, quando as duas PRs forem aprovadas e integradas

1. Confirmar a impressão digital pública confiável de sua chave JKS permanente, sem postar o arquivo ou a senha. Colocá-la na variável de repositório `ATRIO_RELEASE_CERT_SHA256` em **Settings → Secrets and variables → Actions → Variables**. Não adotar o fingerprint de APK desconhecido como fonte confiável.
2. No celular com Termux e GitHub CLI autenticado, baixar o artefato oficial existente (exemplo abaixo) e calcular o hash **do APK extraído**, não do ZIP:

```bash
mkdir -p "$HOME/atrio-apk-validacao"
gh run download 41174393714 \
  -R josuepradodeoliveiracosta-gif/atrio-catolico-android \
  -n atrio-catolico-0.20.0-release-assinado \
  -D "$HOME/atrio-apk-validacao"
sha256sum "$HOME/atrio-apk-validacao/app-release.apk"
```

3. No GitHub, abrir **Actions → OTA Etapa 2 — preparar ou publicar GitHub Release oficial → Run workflow**, na branch `main`, com:
   - `mode: validate`
   - `apk_run_id: 41174393714`
   - `artifact_name: atrio-catolico-0.20.0-release-assinado`
   - `expected_apk_sha256`: resultado do comando acima
   - `release_notes`: texto real e aprovado da versão, com pelo menos 10 caracteres
   - `confirmation`: deixar em branco
4. Conferir sucesso do job e resumo dos valores. **Nenhum release será criado no modo validate.**
5. Após QA do APK no aparelho, conferência de conta/dados, certificado e autorização de distribuição pública, disparar **nova execução** com `mode: publish` e confirmação `PUBLICAR ATRIO`. O pacote será verificado novamente antes de tornar público.

**Importante:** a execução excepcional #41174393714 disponibiliza artefato até **07/11/2026 05:56 UTC**, segundo o GitHub consultado. Se expirar, não reutilizar link; compilar **novo release oficial** pelo fluxo manual aprovado, sem recriar o gatilho excepcional.

## Verificação antes de habilitar para usuários

- [ ] Etapa 1 integrada e auditoria do APK 0.20.0 realmente aprovada.
- [ ] Teste em Android real com `versionCode` superior e assinatura idêntica.
- [ ] Inspeção humana do texto das alterações para não anunciar funcionalidades inexistentes.
- [ ] Regras da branch `main` e regras para tags `v*` revisadas no GitHub.
- [ ] Segredos de assinatura acessíveis apenas aos jobs aprovados e separados do processo de publicação.
- [ ] Modo `validate` executado e confirmado com os hashes reais.
- [ ] Apenas então permitir `publish`.

## Limitações explícitas

A versão atual do Átrio ainda **não** possui detector de atualizações, download interno nem instalador. Esta Etapa 2 prepara a *fonte pública de distribuição*.

GitHub Releases permite que o APK seja baixado sem conta GitHub quando o repositório é público, mas não remove o consentimento do Android para instalar APK externo. Releases podem ser alterados por quem possui permissões suficientes: o futuro cliente deverá validar **assinatura do pacote contra a identidade confiável embutida no app**, SHA-256, versão crescente e HTTPS antes de oferecer a instalação. O SHA-256 presente no próprio manifesto não autentica sozinho a origem.

Se o upload de arquivos falhar, o workflow pode deixar um **release em rascunho**; não automatizar exclusão ou substituição de tags como correção improvisada.

Testes automatizados sem Android/credenciais:
```bash
python3 -m unittest discover -s tests/ota -v
```

Referência: https://cli.github.com/manual/gh_release_create
