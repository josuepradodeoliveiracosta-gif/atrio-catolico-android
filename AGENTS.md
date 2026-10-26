# Continuidade e versão do Átrio

Antes de informar a versão atual ou iniciar uma alteração:

1. Consulte a `main` remota de `josuepradodeoliveiracosta-gif/atrio-catolico-android` e registre seu SHA. Leia `app/build.gradle.kts` nesse SHA, não em uma referência móvel durante a mesma consulta.
2. Diferencie versão integrada, compilação do mesmo commit, artefato release disponível, propostas em PRs e versão instalada no aparelho. Uma categoria não comprova as outras.
3. Use `python3 scripts/status_versao.py` quando houver GitHub CLI autenticado; conectores GitHub podem fazer as mesmas consultas. `--local` descreve apenas a cópia local. Se não houver acesso remoto, declare que o estado atual não foi confirmado; não use memória ou arquivos antigos como substituto.
4. Números em conversas, nomes de APK, transcrições e documentação histórica são contexto, não a fonte da versão atual. Uma PR aberta não é uma versão lançada.
5. Antes de editar, compare a base local com a principal remota para preservar alterações feitas em outros chats. Antes de integrar, confira se a principal mudou e revise a diferença.

Para atualizações do aplicativo, preserve `applicationId`, assinatura permanente e crescimento de `versionCode`. Não modifique o backup protegido. Correções somente de documentação ou ferramentas de consulta não exigem criar uma nova versão Android.

Ao relatar validação, distinga testes automatizados, compilação, publicação de infraestrutura e teste real no aparelho. Não declare recebimento de notificações nem implantação de backend apenas porque o código foi preparado.
