# Auditoria e limpeza — 07/11/2026

## Escopo e referência
Auditoria objetiva de higiene, referências e verificações locais sobre a main
`626e70d7b544e549947aad5f58ae4bde8eb9a1d9`. Não é certificação integral de
segurança nem auditoria do ambiente de produção. Versão integrada consultada:
release 0.20.4/code39; debug 0.19.10/code37. Não comprova APK publicado/instalado.

## Inventário e decisão de limpeza
- 396 arquivos versionados, 5.737.907 bytes (sem histórico Git).
- Nenhuma duplicata exata por hash, arquivo vazio ou arquivo versionado abrangido pelo .gitignore.
- Nenhum APK, ZIP, log, cache Python ou backup identificado no inventário versionado.
- Busca estática não encontrou recursos Android sem referência. Não cobre carregamento dinâmico.
- Maiores recursos preservados: vídeo de abertura (2.306.457 bytes), usado por OpeningVideo.kt;
  catálogo de emojis (608.218 bytes), usado por ReactionEmojiData.kt; lockfile de testes
  (304.786 bytes), necessário ao npm ci.

Removido somente `gradle/wrapper/gradle-wrapper.properties` (201 bytes).
Era a única peça do wrapper: não havia gradlew, gradlew.bat nem gradle-wrapper.jar.
Nenhuma referência externa ao arquivo foi encontrada no repositório. Workflows
instalam Gradle 8.13 via setup-gradle e scripts chamam gradle diretamente.
A remoção não altera a versão do Gradle usada nesses fluxos.
Para adotar wrapper futuramente, gerar e versionar o conjunto completo.

Código de aplicação, regras, assinatura, versão, workflows, testes, documentos
históricos, branches de trabalho e backup protegido foram preservados.
Não há justificativa comprovada para uma exclusão maior.

## Verificações executadas
- Scanner heurístico de segredos: aprovado na árvore atual (396 arquivos);
  não examinou histórico completo e ignora conteúdo acima de 1 MB.
- Validador local da configuração Firebase: aprovado; não consulta produção.
- Python: 103 testes aprovados via unittest discover em scripts.
- Node 24.22.1: 397 resultados, 376 aprovados e 21 falhas preexistentes.
- Manifesto: backup desativado; serviço FCM e FileProvider não exportados.
- Nenhuma compilação Android, teste em aparelho, emulador Firestore ou implantação executada.
  Os testes locais acima não comprovam funcionamento integral do aplicativo.

## Pendências identificadas
1. `cloudflare/push-worker/src/qa-real-auth.test.js:154`: erro de sintaxe
   (aspas após requestId), impedindo carregar a suíte.
2. `cloudflare/push-worker/src/qa-manual.test.js:9`: expressão regular com escape
   excessivo não reconhece o nome "Clara (BOT DE TESTE)".
3. 11 falhas em termux-email-policy-rollout.test.mjs e 8 em
   termux-firestore-rules-guarded-deploy.test.mjs: guardas rejeitam o hash das regras
   locais antes dos cenários esperados. SHA-256 atual de firestore.rules:
   `aa04c106e69287b7e7f513addf3dd4e9fc3ad246b69a7d20b2f38c5068c9899e`.
   Reconciliar fixtures e revisões aprovadas separadamente; não atualizar hashes
   de produção nem desativar guardas apenas para fazer os testes passarem.

## Recuperação e economia
A exclusão é recuperável pelo Git a partir do commit-base acima, sem modificar
o backup protegido ou reescrever histórico. Economia física: somente 201 bytes;
esta limpeza não promete reduzir significativamente tamanho de clone ou APK.
Usados inventário e testes locais existentes, sem instalar dependências,
gerar APK ou disparar manualmente Actions. Workflows automáticos podem executar
ao integrar o commit. Consumo da cota Work não é mensurável nesta sessão.
