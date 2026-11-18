# Átrio Católico — nova diretriz do sistema de diagnóstico: coleta de evidências

**Decisão do proprietário:** 13/11/2026.  
**Situação:** diretriz de produto e desenvolvimento proposta em documentação; a integração na `main` depende de revisão e autorização expressa.  
**Escopo desta alteração:** somente este documento. Não modifica o aplicativo, workflows, classificador, Firebase, Cloudflare, backups nem dados de usuários.

## 1. Mudança de objetivo

O sistema de diagnóstico do Átrio Católico deve ser desenvolvido para ser **altamente eficiente em reunir, contextualizar, organizar e apresentar informações sobre possíveis erros**. Ele deve disponibilizar ao assistente um pacote técnico confiável, rastreável e seguro que permita investigar o problema e propor a correção apropriada.

**O objetivo principal deixa de ser** identificar automaticamente a causa raiz com grau definitivo de certeza ou corrigir erros de forma automática. A análise causal, a decisão sobre a correção, a execução autorizada e a validação do reparo ficam sob responsabilidade do assistente, com revisão e autorizações humanas quando aplicáveis.

A função central passa a ser: **“coletar evidências verificáveis e apresentar o que ocorreu, onde, quando e com quais sinais, deixando explícito o que ainda não foi esclarecido”.**

Não declarar que o novo objetivo já foi implementado ou homologado apenas por registrar esta diretriz.

## 2. Capacidades prioritárias a desenvolver ou aprimorar

1. **Identidade e contexto confiáveis da ocorrência:** identificar repositório, workflow, run ID, job ID, tentativa, commit SHA efetivamente executado, branch/ref, etapa, status, conclusão, horário e ambiente. Rejeitar identidades ambíguas, inconsistentes ou não verificadas; diferenciar o SHA histórico do HEAD atual.
2. **Coleta eficiente e delimitada:** consultar apenas fontes necessárias e autorizadas, privilegiando metadados de CI, logs e artefatos pertinentes com limites de tamanho, paginação, tempo de coleta e número de chamadas. Evitar repetir consultas sem ganho de informação.
3. **Sinais técnicos e evidências:** identificar exceções, códigos de saída, etapas que falharam, indicadores de timeout, testes reprovados, resultados de emulador e outros sinais observáveis. Preservar referências auditáveis a run/job/artefato em vez de publicar conteúdo bruto.
4. **Correlação e organização:** agrupar ocorrências relacionadas por versão, componente, etapa, sintoma e recorrência, sem transformar correlação em causalidade. Registrar quais fontes foram examinadas, quais falharam na coleta e quais continuam pendentes.
5. **Relatório acionável ao assistente:** produzir resumo técnico com fatos confirmados, sintomas, hipóteses explicitamente rotuladas, lacunas, impacto conhecido/desconhecido, fontes e próximos testes seguros sugeridos. Atribuições de causa definitiva não são requisito do coletor.
6. **Privacidade e proteção:** não publicar tokens, segredos, dados pessoais, logs brutos sensíveis ou caminhos internos desnecessários em PRs e artefatos; empregar sanitização e estados fechados. Falhas de coleta devem resultar em `indisponível` ou `inconclusivo`, nunca em dados ou percentuais inventados.
7. **Operação previsível:** relatórios reproduzíveis para um mesmo conjunto de entradas; tratamento de indisponibilidade de API, artefato ausente e testes interrompidos; nenhuma alteração automática em `main`, produção, backups, dados, regras ou infraestrutura.

### Estrutura-alvo de um relatório por ocorrência

Esta é uma **proposta de contrato**, não uma afirmação de que todos os campos já existem ou estão populados:

| Grupo | Informações esperadas |
| --- | --- |
| Identificação | ID da ocorrência, repositório, run/job/tentativa, workflow, commit SHA, etapa e data |
| Coleta | Fontes consultadas, referências/links, status por fonte, limites e lacunas |
| Sintomas | Erros observados, falhas de testes, códigos de saída, classificações de sinais e recorrência |
| Contexto | Componente afetado, ambiente e comparação com outras execuções quando demonstrável |
| Qualidade | Origem verificável, integridade dos dados, itens não verificados e grau de completude |
| Análise assistida | Hipóteses **não confirmadas**, perguntas em aberto e próximos passos seguros |
| Segurança | Indicadores de sanitização, ausência de conteúdo bruto publicado e escopo das permissões |

Manter distinções explícitas entre **fato observado**, **indício**, **hipótese**, **causa comprovada por revisão independente**, **teste executado** e **correção efetivamente validada**.

## 3. O que preservar do trabalho anterior

Os componentes já integrados à `main` para consolidação por SHA, triagem de sinais, verificação de identidades, indicadores, fila de revisão e auditoria de execução **continuam potencialmente úteis como fontes ou controles de qualidade**. Não é necessário reverter merges unicamente porque a estratégia mudou.

As estruturas históricas ligadas à análise causal e autocorreção devem ser **reavaliadas quanto à prioridade e à elegibilidade**, sem exclusão, desativação ou afrouxamento automático de proteções. A mudança de diretriz **não implica** que workflows de autocorreção existentes tenham sido desligados.

As metas anteriores de **90% de precisão causal** e **99% de autocorreção elegível** deixam de ser critérios obrigatórios para a homologação do **coletor de evidências**. Podem continuar documentadas como metas históricas ou de iniciativas separadas, mas não podem ser apresentadas como resultados demonstrados. A linha de base histórica com 13 falhas e 3 controles permanece intacta, com `0/13` revisões causais independentes registradas no momento desta decisão.

A investigação experimental dos erros Firestore na PR [#277](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/277) é um **estudo de caso para verificar qualidade de coleta**, não mais um bloqueador que precise ter sua causa raiz resolvida para homologar o novo objetivo. Ela continua em rascunho, sem autorização de merge ou deploy.

## 4. Priorização para o próximo desenvolvimento

A ordem sugerida, sujeita à inspeção do estado real do repositório antes de cada alteração, é:

1. **Inventariar as saídas e fontes atuais** do diagnóstico e definir quais evidências faltam em ocorrências reais e sintéticas.
2. **Definir e testar o contrato de relatório**: campos obrigatórios, valores ausentes, proveniência, deduplicação, integridade e sanitização.
3. **Aprimorar a coleta e a correlação** com controles de custo/tempo de execução e recuperação de erros da própria ferramenta.
4. **Validar o fluxo de ponta a ponta**: falha sintética ou histórica → fontes verificadas → relatório completo/explicitamente incompleto → análise viável pelo assistente.
5. **Homologar a utilidade e a segurança** do coletor antes de propor qualquer integração à `main`.

Preferir reutilizar os scripts e workflows atuais à criação de infraestrutura paralela. Nenhum serviço pago, credencial, acesso adicional ou ação de produção deve ser introduzido sem autorização específica.

## 5. Critérios de aceitação do novo objetivo

A homologação do **sistema de coleta de evidências**, quando implementado, exige demonstrar:

- **Rastreabilidade:** cada informação importante aponta para uma fonte verificável, commit e execução corretos, ou traz estado explícito de não verificação.
- **Completude mensurada:** casos de teste possuem lista previamente definida de informações esperadas; o relatório contabiliza obtidas, ausentes e indisponíveis, sem inventar valores.
- **Correção do relato:** sinais e erros são reproduzidos fielmente nos metadados permitidos; fatos e hipóteses não se confundem.
- **Segurança:** testes automáticos comprovam bloqueio de segredos/dados pessoais e comportamento conservador com entradas hostis ou incompletas; nenhum log bruto sensível é publicado.
- **Eficiência comprovada:** medir tempo, chamadas e tamanho dos artefatos em cenários representativos; comparar com uma linha de base antes de fixar metas numéricas.
- **Resiliência:** timeout, API indisponível, artefato ausente e IDs inválidos produzem relatório parcial verificável ou falha controlada.
- **Integração segura:** testes offline, Firestore Emulator e Android quando aplicáveis, dependências, segurança e CodeQL são conferidos no HEAD exato de qualquer PR candidata.

Não usar workflow verde, total de sinais capturados, `writer=skipped` ou um experimento de Firestore como prova isolada de qualidade global ou homologação. O coletor **não precisa corrigir erros ou atestar a causa raiz** para satisfazer estes critérios.

## 6. Limites de autorização e continuidade

- Trabalhar em branches próprias; nunca fazer push direto, merge ou alteração na `main` sem autorização expressa.
- Nunca modificar backups originais sem autorização, nem Firebase/Cloudflare produtivos, usuários, dados reais, assinaturas ou deploys por causa desta diretriz.
- Reaproveitar componentes funcionais, mas examinar a implementação atual antes de qualquer mudança; preservar a identidade católica do aplicativo.
- Registrar por etapa: commit exato, escopo do diff, testes efetivamente executados, limitações, pendências, progresso com denominador explícito e próximo passo verificável.
- Documentos e métricas anteriores permanecem como histórico técnico; em caso de conflito de **priorização futura**, esta decisão do proprietário passa a orientar o desenvolvimento do sistema de diagnóstico, após ser integrada de forma autorizada.

### Referências do histórico

- [Indicadores do diagnóstico — etapa 10](diagnosticos-etapa10-indicadores-baseline-2026-11-13.md)
- [Fila de revisão causal — etapa 13](diagnosticos-etapa13-fila-revisao-causal-2026-11-13.md)
- [PR #274 — integração de indicadores e auditoria](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/274)
- [PR #275 — fila auditável de revisão](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/275)
- [PR #277 — laboratório forense Firestore ainda separado da `main`](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/277)
