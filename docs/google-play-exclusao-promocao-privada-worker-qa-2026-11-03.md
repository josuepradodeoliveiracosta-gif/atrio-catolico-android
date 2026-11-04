# Átrio Católico — auditoria de promoção privada do Worker QA

**03/11/2026 — revisão na PR #71. Somente verificação offline; nenhuma implantação.**

## Resultado observado

- O Worker `atrio-privacy-freeze-qa-internal` mantém versão hospedada `8d2b5461-f839-49bd-8f2b-3300c58eb6a6` no deploy `4a9f4898-a414-496a-b5fa-c26f644ee658` (03/11/2026 21:22 UTC).
- A versão disponível na API Cloudflare tem apenas `workers/triggered_by: upload`, sem `workers/commit_sha`. **Não é possível provar que corresponda ao commit atual da PR.**
- Quatro Workers QA com subdomínio e previews desativados e sem agendamentos. Os três consumidores têm binding de serviço para o coordenador privado.
- No D1 fictício há duas contas (`active=1`, `frozen=1`), zero tickets em andamento, zero contas congeladas com tickets e um caso QA no checkpoint 1.
- Os três Workers oficiais não têm vinculação ao QA. A API de rotas por zona exige inventário das zonas; essa verificação permanece **inconclusiva** e não deve ser preenchida com `true` sem revisão.

## Novo bloqueio no repositório

`assessQaHostedStagePromotion` valida um retrato sanitizado de quatro Workers QA e três de produção. Exige SHA do commit em todas as versões efetivamente distribuídas, artefato com hash e atestado de revisão independente, bindings com allowlist exata, nenhuma rota pública/cron, ausência de vinculação QA à produção, D1 dedicado e contagem segura de operações.

Uma observação válida gera **somente** `metadata_preflight_only`, jamais autoriza exclusões, publicação na Play Store, assinatura ou deploy. O retrato observado na Cloudflare está bloqueado por ausência de proveniência do código e cobertura de rotas por zona ainda não certificada.

## Etapa operacional futura

Preparar e verificar um bundle reproduzível por CI, comparar hash com artefato final, revisar todas as zonas e bindings, registrar versão anterior para rollback e obter autorização explícita de promoção do Worker privado. Não implantar pelo template Wrangler intencionalmente não implantável, nem configurar secrets ou rotas sem revisão. O projeto de produção deve continuar inalterado.
