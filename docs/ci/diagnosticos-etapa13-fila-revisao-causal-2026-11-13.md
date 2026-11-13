# Etapa 13 — Preparação auditável para revisão humana de causas (QA)

**Data:** 13/11/2026. **Escopo:** pacote somente leitura para análise humana;
nenhuma atribuição de causa, elegibilidade ou reparo automático.

## Evidência existente, sem extrapolações

Após a integração da PR #274, os quatro workflows de `push` foram
aprovados: versão, segurança, APK e CodeQL. O workflow automático QA
`43489672113` teve o preflight `success` e o job escritor `skipped`,
pois nenhuma receita de reparo foi selecionada. Um job `skipped` não é
um reparo malsucedido de caso elegível.

A amostra congelada `docs/ci/datasets/diagnostics-holdout-v1.json`
contém **16 jobs históricos**: 13 falhos e 3 controles aprovados.
Nas falhas, 3 apresentam sinal específico, 3 apenas sinal genérico
e 7 permanecem inconclusivas. **Nenhuma revisão humana de causa raiz**
foi verificada nessa amostra. O holdout é relativo a sete regras
e não foi obtido como amostra representativa cega do classificador inteiro.

## Nova fila de revisão

`scripts/ci_diagnostic_review_queue.py` gera tarefas **pendentes** para
cada um dos 13 jobs falhos, preservando ID de run e job, conclusão e sinais
já constantes na fonte. A documentação gerada traz links para inspecionar
os jobs e uma lista de verificações manuais necessárias. **Não inspeciona
logs nem afirma que as referências foram conferidas.** Não permite trocar
a amostra congelada por dados manipulados; recusa inserir uma
atestação humana por simples edição da fonte.

Para gerar relatórios locais (o diretório escolhido deve existir e
os nomes de destino não podem existir previamente):

```bash
python3 -m scripts.ci_diagnostic_review_queue \
  --manifest docs/ci/datasets/diagnostics-holdout-v1.json \
  --json /tmp/atrio-causal-review-queue.json \
  --markdown /tmp/atrio-causal-review-queue.md
```

No Termux, pode-se substituir `/tmp` por `$PREFIX/tmp`.

## Procedimento futuro para cada caso

1. Um revisor humano autorizado confere se o run/job e seu SHA
   correspondem ao caso original, usando os recursos do GitHub.
2. Identifica uma causa real, com evidências suficientes e avaliação
   independente, **sem transferir logs privados para o repositório**.
3. Registra uma referência auditável sem dados pessoais ou credenciais.
4. Documenta separadamente: sinal observado, causa confirmada,
   elegibilidade para reparo, execução real do reparo e teste posterior.
5. Só depois, com casos representativos e verificados, define a
   contagem e metodologia para avaliar a meta causal de 90%.
6. Para a meta de 99%, estabelece antecipadamente quais procedimentos
   são elegíveis e exige comprovantes independentes de correção,
   incluindo falhas, reversões e casos inconclusivos.

**Nenhum preenchimento automático de resultados humanos está permitido.**
Esta etapa não mede precisão nem taxa de autocorreção; somente torna
reproduzível a organização dos casos que precisam de investigação.

## Proteções

Os testes `scripts.test_ci_diagnostic_review_queue` foram acrescentados
ao gate obrigatório existente `.github/workflows/selos-ci.yml`.
Não foram criados workflows, gatilhos, tokens, secrets, novos serviços
nem fontes de dados. Nenhuma escrita na main, backups, Firebase, Cloudflare,
dados de usuários, deploy, merge ou publicação de APK faz parte desta PR.
