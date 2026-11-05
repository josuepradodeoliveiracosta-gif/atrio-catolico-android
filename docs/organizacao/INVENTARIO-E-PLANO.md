# Inventário e plano de migração — 04/11/2026

## Fotografia auditada (não atualização automática)

| Referência | Commit | Arquivos | `docs/` | Workflows |
| --- | --- | ---: | ---: | ---: |
| `main` base desta organização | `f4500c86f81d0cb093741e89f7c5457290c10fa0` | 258 | 49 | 21 |
| PR #71 em homologação | `c8b9ab1d62e899af26a01cd32c0f12618b7ec7fd` | 533 | 107 | 23 |

As contagens são de SHAs específicos e não comprovam publicação. A branch `backup/v0.12.0-2026-10-25` permanece **intocável sem autorização específica**.

## Atualização da situação em 04/11/2026

A tabela abaixo substitui **somente o estado de execução** do plano inicial; a fotografia de commits anterior permanece como histórico. No commit `e055ce2a9a234b321d6525de632cf8e763310e20`, a `main` possui 278 arquivos versionados, 61 arquivos em `docs/` e 21 workflows, segundo árvore recursiva não truncada.

| Etapa | Resultado da fase organizacional | Limite e seguimento |
| --- | --- | --- |
| 1 — Inventário | **Concluído para a estrutura atual** via PR #100 | Auditoria exaustiva por módulo somente se for proposta migração; [Issue #102](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/102) |
| 2 — Navegação | **Índice e links centrais integrados**, 40/40 links locais de quatro documentos conferidos | Revisão visual GitHub Android/desktop [pendente](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/101), não presumida |
| 3 — Design/gestão | **Biblioteca base e templates de Issues integrados** pela PR #100 | PR #113 detalha design futuro, **em draft**, aguardando aprovação |
| 4 — Migração técnica | **Decisão: não realizar** sem necessidade funcional e ganho comprovado | Qualquer migração física requer nova avaliação, PR separada, teste e autorização |
| 5 — Otimização Actions | **Implementação inicial integrada** pela PR #110, com verificações obrigatórias mantidas e ensaios documentais aprovados | Economia monetária não medida; acompanhar pela [Issue #103](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/103) |

Consulte o [termo de encerramento da fase de organização](ENCERRAMENTO-FASE-2026-11-04.md) para a matriz de evidências, decisões e as tarefas de operação/desenvolvimento que permanecem abertas.

## Antes de uma futura migração física

- Confirmar `main` e branches remotas atualizadas.
- Inventariar Kotlin/Gradle, imports relativos, Node, Worker, Firebase, scripts, CI e links externos.
- Criar PR menor por assunto, com rollback e cobertura das dependências.
- Não misturar com a PR #71 nem reescrever o histórico.
- Não tocar em segredos, backups, dispositivos reais ou serviços de produção.
- Validar que o diff documental atual não altera `app/`, `cloudflare/`, `tests/`, `scripts/` nem workflows.

[Índice](../INDEX.md) · [Fluxo](FLUXO-DE-TRABALHO.md).
