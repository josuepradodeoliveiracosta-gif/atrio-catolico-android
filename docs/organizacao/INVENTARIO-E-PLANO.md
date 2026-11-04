# Inventário e plano de migração — 04/11/2026

## Fotografia auditada (não atualização automática)

| Referência | Commit | Arquivos | `docs/` | Workflows |
| --- | --- | ---: | ---: | ---: |
| `main` base desta organização | `f4500c86f81d0cb093741e89f7c5457290c10fa0` | 258 | 49 | 21 |
| PR #71 em homologação | `c8b9ab1d62e899af26a01cd32c0f12618b7ec7fd` | 533 | 107 | 23 |

As contagens são de SHAs específicos e não comprovam publicação. A branch `backup/v0.12.0-2026-10-25` permanece **intocável sem autorização específica**.

| Etapa | Entrega | Regra |
| --- | --- | --- |
| 1 — Inventário | Mapa, fontes, dados e dependências | Registro documental, sem remover arquivos |
| 2 — Navegação | Índice, estado, critérios e histórico | Links que apontam para os originais |
| 3 — Design/gestão | Biblioteca visual e modelos de Issues | Sem instalar ou alterar componentes Android |
| 4 — Migração técnica | Mover/refatorar por módulo | **Não iniciada**; PR e testes específicos |
| 5 — Otimização Actions | Reduzir custos com cobertura equivalente | **Não iniciada**; medir antes/depois |

## Antes de uma futura migração física

- Confirmar `main` e branches remotas atualizadas.
- Inventariar Kotlin/Gradle, imports relativos, Node, Worker, Firebase, scripts, CI e links externos.
- Criar PR menor por assunto, com rollback e cobertura das dependências.
- Não misturar com a PR #71 nem reescrever o histórico.
- Não tocar em segredos, backups, dispositivos reais ou serviços de produção.
- Validar que o diff documental atual não altera `app/`, `cloudflare/`, `tests/`, `scripts/` nem workflows.

[Índice](../INDEX.md) · [Fluxo](FLUXO-DE-TRABALHO.md).
