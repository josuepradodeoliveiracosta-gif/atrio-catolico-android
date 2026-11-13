# Ensaio de integração segura — Diagnóstico automático (PRs #271–#273)

**Data:** 13/11/2026. **Modo:** QA em branch separada, sem merge/deploy.

## Origem e preservação de histórico

- Base examinada: `main` `9949943a16b8b97caedac80c393ae49befa87c0f`, protegida.
- Esta branch deriva do HEAD da **PR #273**
  (`6c10c63e3baf646b24a37bbc9709d4f9cb8e32f7`), preservando
  integralmente o auditor read-only aprovado.
- Os **dois arquivos** modificados na **PR #271** foram importados por
  conteúdo idêntico, sem alterar suas proteções de IDs canônicos.
- Os **três arquivos novos** da **PR #272** foram importados por conteúdo
  idêntico, preservando o mesmo holdout fixado e o relatório KPI offline.
- A única conciliação de código entre #272 e #273 foi a linha de testes em
  `.github/workflows/selos-ci.yml`: a execução agora contém tanto
  `scripts.test_ci_diagnostic_kpi_baseline` quanto
  `scripts.test_ci_autofix_run_outcomes`, sem excluir as demais suítes.

## Critérios de verificação

1. Comparar o conteúdo dos arquivos herdados com os respectivos blobs
   originais nas três PRs; **nenhum patch deve ser refeito ou simplificado**.
2. Verificar no diff da integração somente os arquivos das PRs #271–#273
   mais esta documentação. Nenhuma permissão, trigger, job ou token novo.
3. Confirmar no HEAD deste ensaio o gate offline obrigatório, o Firestore
   Emulator de QA, o build Android e CodeQL Kotlin, JS, Python e Actions,
   além de versões, segredos e dependências.
4. Não confundir **checks de CI verdes** com comprovação de reparo automático
   ou de 90% de precisão causal. As metas de automação de 99% e diagnóstico
   causal de 90% **continuam não demonstradas**.
5. Uma integração futura deve exigir revisão humana e autorização de merge
   específica, reconsultando `main` e o HEAD desta PR antes de executar.

## Decisão de integração

Esta PR é um **ensaio de composição**, não três merges independentes.
As PRs originais **#271, #272 e #273 permanecem abertas e intactas** para
rastreabilidade. Não integrar versões duplicadas e desatualizadas após eventual
aprovação de uma única proposta consolidada. Seu encerramento posterior,
se desejado, exige decisão explícita do proprietário.

**Sem modificações em produção, Firebase, Cloudflare, dados reais, backups,
assinatura Android ou serviços pagos.** A auditoria de QA só consulta
metadados padronizados com token de leitura quando acionada por operador;
os testes de CI usam exclusivamente fixtures em memória.
