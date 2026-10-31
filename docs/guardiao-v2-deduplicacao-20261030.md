# Auditoria de redundâncias — Átrio Guardião Autônomo V2

**Referência:** 30/10/2026 (America/Fortaleza). Comparação estática da `main` no commit `228dc9d2b38c6f1783959059806687d0f754d3a5` com a PR #44 (`72cc20a78b860bac147bc79b6b035ae100e2e31b`). Esta revisão altera exclusivamente código offline e integração contínua em **branch isolada**, sem autorização de implantação.

## Diagnóstico por área

| Área | Achado verificável | Tratamento |
| --- | --- | --- |
| PR #44 obsoleta | A árvore da PR #44 tem 274 arquivos, sendo **185 idênticos byte a byte à main**, 13 com mesmo caminho mas conteúdo divergente e 76 existentes só na PR. A main tem outros 15 arquivos ausentes na PR. Há 8 workflows de laboratório exclusivos da PR. | **Não integrar a PR #44 integralmente.** Reaproveitar apenas diferenças ainda relevantes, selecionadas e rebaseadas sobre a main atual, com revisão própria. |
| QA — respostas Firestore | `qa-wif-probe.js` e `qa-keyless-cycle.js` continham duas implementações do mesmo leitor de HTTP/JSON com máximo 8 KiB, streaming e UTF-8 estrito. | **Corrigido nesta proposta:** parser único exportado como `readQaBoundedJson` do módulo WIF, usado pelos dois fluxos. Permanecem duas provas distintas, mas sem duplicação da leitura e sem GET adicional. |
| Classificador | `decide(finding, settings, flags)` recebia dois parâmetros ignorados e retornava `review` duas vezes para situações equivalentes. | **Corrigido:** mantém `clear`, `warn` e `review` existentes, remove parâmetros ignorados e ramificação duplicada. A avaliação independente de `hold` continua em `processDocument`. |
| CI da branch histórica | `guardiao-v2-qa-keyless-cycle-ci.yml` só escutava `push` da branch de desenvolvimento `feature/guardiao-v2-qa-keyless-cycle-20261030`, depois de o código ter sido integrado à `main`. A suíte QA já é coberta por `npm test` do `guardiao-v2-motor-ci.yml` quando os arquivos do Guardião mudam em PR. | **Removido da proposta baseada na main** para não manter mais um workflow específico de etapa concluída; não alteramos a branch histórica. |
| Segurança e processamento | Scanner paginado/checkpoints, idempotência transacional, verificações de edição, autorizações independentes, `emergencyStop` e retenção somente autorizada são camadas diferentes, não cópias dispensáveis. | **Mantidos integralmente.** Não retirar validações redundantes em aparência, mas necessárias como defesa em profundidade. |
| Moderação supervisonada vs. V2 | Filtro local, denúncia humana, UI de revisão, testes QA e motor servidor têm responsabilidades e limites diferentes. | **Preservados.** Não fundir classificação local com decisões backend ou com políticas de autorização do Firestore. |
| Infraestrutura e custo | Prova WIF manual tem branch/identidade restritas; Cloudflare Cron QA não herda identidade OIDC GitHub. Código V2 integrado não equivale a operação 24/7. | Sem mudanças em cron, PAM/PAT, WIF, IAM, Firestore, Worker, cobrança, snapshots ou APK. Não declarar autonomia produtiva ativa. |
| Visibilidade do repositório | Metadados atuais de GitHub indicam repositório **público**, enquanto o `README.md` afirma que ele é privado. | Apontado como incongruência documental/de segurança. Não modificar visibilidade sem autorização separada; nunca adicionar credenciais ao Git. |

## Correções efetivas nesta branch

1. `cloudflare/guardian-worker/src/qa-wif-probe.js` — centraliza parser 8 KiB, verifica tamanho mesmo sem Content-Length, rejeita corpo não-streaming, bytes inadequados, JSON inválido e UTF-8 inválido; sem expor conteúdo.
2. `cloudflare/guardian-worker/src/qa-keyless-cycle.js` — reutiliza parser comum mantendo checagem de contexto manual, URL de fixture fixa, timeout, ausência de redirecionamento e saída apenas em contadores.
3. `cloudflare/guardian-worker/src/policy.js` e `src/index.js` — simplificam retorno determinístico, sem alterar sinais de moderação nem `GUARDIAN_V2_*APPROVED`.
4. `.github/workflows/guardiao-v2-qa-keyless-cycle-ci.yml` — exclusão de workflow histórico que não monitora a main; testes seguem no workflow central.

## Verificações e limites

- Antes do merge: exigir CI `guardiao-v2-motor-ci.yml` com `npm run check` e `npm test`, incluindo provas offline WIF, keyless, segurança e casos concorrentes.
- A mudança de implementação não altera assinatura, `applicationId`, versão do Android ou `versionCode`.
- Um teste offline aprovado **não** comprova serviço em produção, custos, disponibilidade 24/7, IAM mínimo, leitura contínua ou ausência total de falsos positivos.
- **Pendências bloqueadoras preservadas:** identidade keyless do executor recorrente para o ambiente autorizado, escopo IAM independente, regras Firebase e homologação ponta a ponta, prevenção de custos, aprovação humana e rollout gradual começando apenas por triagem.
- **Proibido por esta PR:** ativar `GUARDIAN_V2_ENABLED`, `GUARDIAN_V2_HOLD_ENABLED`, `GUARDIAN_V2_HOLD_APPROVED`, publicar release, executar deploy, modificar backups ou abrir acesso privilegiado.
- No futuro, o desmembramento da PR #44 deve descartar os 185 arquivos já integrados e revisar separadamente os 13 divergentes e 76 exclusivos; não copiar `firestore.rules` nem `src/index.js` de uma base antiga para a main sem análise de regressão.

## Critério para aceitar

Aprovar somente se a CI de motor passar e a comparação `main...branch` confirmar exatamente a deduplicação descrita. Deixar a `main` e o backup intactos até decisão explícita sobre a PR.
