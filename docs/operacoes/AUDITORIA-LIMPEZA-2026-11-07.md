# Auditoria técnica e limpeza — 07/11/2026

## Escopo e base

Revisão da `main` em `626e70d7b544e549947aad5f58ae4bde8eb9a1d9`: 396 arquivos versionados, árvore remota completa e cópia Git limpa. Gradle: release candidato 0.20.4/code39 e debug 0.19.10/code37. Esses metadados não comprovam distribuição ou instalação.

Foram examinados inventário, consumidores dos candidatos à remoção, recursos Android, configuração Firebase, manifesto, workflows, políticas de assinatura/publicação, arquivos ignorados, documentação, segredos e testes offline. Não é um pentest nem certificação de segurança; não houve leitura de dados de usuários nem alteração em produção. A PR #193 de Conversas e as demais propostas abertas não foram modificadas nem consideradas integradas.

## Achados que exigem acompanhamento

| Prioridade | Evidência na base | Consequência e encaminhamento |
| --- | --- | --- |
| Alta | `npm audit` em `tests/security`: 27 pacotes afetados, incluindo `tar` classificado como crítico | Tratar dependências da cadeia de testes/CLI em atualização validada; não confundir com dependências Android nem executar correção forçada. |
| Média | `cloudflare/push-worker/src/qa-real-auth.test.js:154` contém uma aspa excedente após `requestId` | A suíte não chega a executar por erro de sintaxe. Corrigir e executar em mudança de testes separada. |
| Média | `cloudflare/push-worker/src/qa-manual.test.js:9` usa expressão regular com escape duplicado | O teste rejeita o nome válido `Clara (BOT DE TESTE)`. Corrigir a expressão sem mudar a identidade dos bots. |
| Média | `scripts/termux-email-policy-rollout.mjs` e `scripts/termux-firestore-rules-guarded-deploy.mjs` fixam hashes de regras anteriores | 19 testes dos procedimentos antigos falham ao carregar as regras atuais. Os procedimentos recusam a operação antes de escrever, como proteção. Não atualizar hashes automaticamente; reauditar o procedimento e desacoplar fixtures históricas das regras atuais. |
| Média | `.github/workflows/cloudflare-push-ci.yml` executa `index.test.js`, mas não as duas suítes `qa-*.test.js` | CI verde desse workflow não cobre os erros acima. Ampliar cobertura junto à correção dos testes. |
| Baixa | Quatro componentes de medalhas sem chamadas após adoção de `MinimalBadgeIcon` | Nove arquivos desnecessários removidos nesta limpeza, conforme inventário abaixo. |
| Baixa | `.gitignore` não abrangia AAB, cache Kotlin e estado Wrangler | Acrescentados `*.aab`, `.kotlin/` e `.wrangler/` para impedir inclusão acidental de saídas locais. |

As falhas de testes acima foram reproduzidas **antes** da limpeza. Não foram eliminadas removendo testes ou alterando proteções operacionais. A consulta `npm audit --package-lock-only --json`, executada em `tests/security`, reportou 27 pacotes afetados: 1 crítico (`tar`, transitivo de ferramentas), 10 altos e 16 moderados. São dependências Node do ambiente de testes/CLI; este resultado não demonstra vulnerabilidade no APK Android. Os totais incluem dependências transitivas e não equivalem a 27 falhas distintas exploráveis. Priorizar a atualização compatível de `firebase-tools`, Firebase e ferramentas de teste com emulador e CI; não aplicar `npm audit fix --force`, que propõe mudanças de versão principal e até regressões de versão. Lockfile preservado nesta limpeza.

## Limpeza executada

Remoção de 108.922 bytes de conteúdo versionado (aproximadamente 106,4 KiB), sem estimar redução do APK comprimido:

| Componente removido | Recurso removido em `app/src/main/res/raw/` |
| --- | --- |
| `DeaconBadgeArt.kt` | `selo_diacono_base64.txt` |
| `PriestBadgeArt.kt` | `selo_padre_base64.txt` |
| `LayBadgeArt.kt` | `selo_leigo_base64.txt` e `selo_leiga_base64.txt` |
| `ModeratorBadgeArt.kt` | `selo_moderador_base64.txt` |

Os componentes ficavam em `app/src/main/java/br/com/atriocatolico/`. Busca em todo o código, testes, scripts, XML e configuração não encontrou consumidores fora dos próprios arquivos removidos. Também foram procurados carregamentos por `getIdentifier` e reflexão; nenhum consumidor foi encontrado. Referências documentais receberam notas históricas. Os ícones atuais continuam em `MinimalBadgeIcon.kt`.

Preservados: `FounderBadgeArt.kt` e sua imagem (usados em `ProfileScreen.kt`), vídeo de abertura (usado em `OpeningVideo.kt`), licenças, lockfile, configurações Firebase, exemplos Wrangler, testes, workflows, documentação histórica e scripts operacionais. Nenhum arquivo já rastreado correspondia aos padrões ignorados existentes. Não foram apagadas branches, releases, artefatos remotos nem histórico Git.

## Verificações executadas localmente

| Verificação na base | Resultado |
| --- | --- |
| `python3 scripts/check_public_secrets.py --history` | Aprovada: 396 arquivos atuais e 3.345 blobs históricos alcançáveis. Scanner heurístico; ignora conteúdo de blobs acima de 1 MB e não garante ausência de segredos. |
| `python3 scripts/validar_firebase.py` | Configuração local válida; não verifica implantação remota. |
| `python3 -m unittest discover -s scripts -p 'test_*.py'` | 103 testes aprovados. |
| `python3 -m unittest discover -s tests/ota -v` | 31 testes aprovados. |
| `python3 -m unittest discover -s tests/qa_official -v` | 19 testes aprovados, com dados sintéticos. |
| Suítes Node offline (comando abaixo) | 397 entradas: 376 aprovadas e 21 falhas, incluindo o arquivo com erro de sintaxe. |

Comando Node utilizado:

```sh
node --test cloudflare/*test.mjs cloudflare/avatar-worker/src/*.test.js cloudflare/push-worker/src/*.test.js cloudflare/guardian-worker/src/*.test.js scripts/*.test.mjs tests/*.test.mjs
```

Após a limpeza: conferir referências restantes, integridade de recursos/links alterados, `git diff --check` e scanner de segredos. A compilação Android e os testes Firestore devem ser verificados na execução da PR correspondente; não havia Gradle/SDK Android instalados no ambiente local. Testes instrumentados em aparelho, instalação, recebimento de push e deploy não foram executados nesta auditoria.

## Segurança e reversão

A branch `backup/v0.12.0-2026-10-25`, observada em `65c48f4f871f6914477db33bcbf67fbcbb055d66`, não foi modificada. Nenhum backup externo foi aberto ou alterado. A limpeza não muda versão, assinatura, applicationId, regras Firestore ou Workers.

Os arquivos removidos continuam recuperáveis no [commit anterior](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/tree/626e70d7b544e549947aad5f58ae4bde8eb9a1d9). Para reverter, produzir um commit inverso da limpeza com revisão de conflitos; não usar reset/force-push, pois existem trabalhos paralelos.
