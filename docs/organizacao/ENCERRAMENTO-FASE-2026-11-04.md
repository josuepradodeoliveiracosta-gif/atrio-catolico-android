# Encerramento da fase de organização — Átrio Católico

**Data de referência:** 04/11/2026 · **Escopo:** organização do repositório, documentação, governança e otimização inicial de CI. Este registro não é uma publicação do aplicativo nem uma autorização para implantar serviços.

## Critério de encerramento

A **fase de organização básica** pode ser encerrada quando o repositório possui um ponto de entrada confiável, mapa de responsabilidades, status por evidência, regras de gestão de mudanças, proteção de branches e uma decisão explícita sobre o risco/custo de mover arquivos. Não exige que todos os recursos futuros do aplicativo estejam prontos. Nenhuma tarefa pendente é apagada ou considerada concluída por conveniência.

## Matriz de aceite da organização

| Frente | Decisão e evidência | Estado da entrega organizacional |
| --- | --- | --- |
| 1. Inventário e arquitetura | [PR #100](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/100), [mapa](../arquitetura/MAPA-REPOSITORIO.md), [inventário](INVENTARIO-E-PLANO.md). Fotografia da `main` em `e055ce2`: 278 arquivos versionados, 61 em `docs/`, 21 workflows | **Concluída para a organização básica**; dependências detalhadas sob demanda |
| 2. Navegação e fontes de verdade | [Índice](../INDEX.md), [estado dos módulos](../funcionalidades/STATUS.md), [Issue #101](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/101). Foram verificados 40 links internos em quatro documentos centrais, sem caminhos faltantes | **Integrada e validada estaticamente**; revisão visual em GitHub Android/desktop continua pendente |
| 3. Gestão de tarefas e design | [Fluxo](FLUXO-DE-TRABALHO.md), [biblioteca de design](../../design/README.md), [Issue #104](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/104) | **Estrutura de gestão e biblioteca concluídas**; proposta visual [PR #113](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/113) segue draft, sem aprovação |
| 4. Migração física de diretórios | [Issue #102](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/102): riscos catalogados em 21 workflows e scripts; referências relativas e filtros `paths` são relevantes | **Decidida como não necessária** à organização básica; não mover código sem benefício comprovado, PR técnica e aprovação específica |
| 5. Otimização inicial do Actions | [PRs #107](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/107), [#108](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/108), [#110](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/110), [Issue #103](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/103): PR documental classificada sem APK extra e com 4 checks obrigatórios preservados | **Otimização técnica inicial integrada e testada**; economia monetária ainda não quantificada |

## Decisões e limites importantes

- **Manter um repositório único.** `app/`, `cloudflare/`, `tests/`, `scripts/`, `.github/workflows/` e as regras Firebase continuam nos caminhos de referência. Organizar não é sinônimo de mover.
- **Preservar a `main` e o backup:** confirmar regras ativas antes de merge; não alterar `backup/v0.12.0-2026-10-25` e não publicar credenciais.
- **Preservar a CI exigida:** nunca dispensar detecção de segredos, verificação de versões, compilação Android de testes ou teste de regras Firestore para mascarar custo. A dispensa documental atinge **somente o APK adicional não obrigatório**.
- **Manter os estados separados:** `Planejado`, `Em desenvolvimento`, `Em homologação`, `Integrado`, `Publicado` e `Bloqueado`. Merge de documentação não prova APK instalado, regras implantadas ou funcionalidades em produção.
- **Não presumir economia em reais:** dispensar build comprovadamente não equivale a minutos faturados ou dinheiro poupado. Aferição de billing e monitoramento pertencem à operação contínua.

## Pendências transferidas para frentes independentes

| Referência | Por que continua pendente | Por que não bloqueia a organização básica |
| --- | --- | --- |
| [Issue #101](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/101) | Revisão **visual** no aplicativo GitHub Android e desktop não foi feita por esta auditoria de API | Índice, estrutura e links locais já são verificáveis; não fingir validação visual |
| [PR #113](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/113) e [Issue #104](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/104) | Design detalhado depende de avaliação/aprovação; PR ainda está em **draft**, não integrada | Biblioteca e gestão de propostas já existem; evolução de interfaces é desenvolvimento |
| [Issue #102](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/102) | Auditoria exaustiva por módulo só é necessária se algum diretório **for** migrado | Decisão atual é não realizar migração arriscada sem justificativa |
| [Issue #103](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/103) | Medição de consumo real e regressões futuras | Otimização inicial já foi integrada e validada |
| [Issue #106](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/106) | Rever limite de observação do Guardião com testes offline; não alterar cron de produção automaticamente | É segurança/operação do Guardião, não organização do repositório |
| [Issue #114](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/114) | Corrigir contraste da interface após aprovação visual | É melhoria de acessibilidade do APK, não navegação de arquivos |
| [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71), [Issue #72](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/72) e [Issue #99](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/99) | Privacidade, homologação Google Play e regras da comunidade | Mudanças de produto/publicação exigem processos próprios |

## Regra para declarar concluída

Este documento só passa de **proposta de encerramento** a **encerramento organizacional registrado na `main`** quando a PR que o introduz for integrada, com checks obrigatórios aprovados no SHA da PR e links verificados. A [Issue central #105](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105) deve então apontar para este arquivo e anotar o SHA do merge; não encerrar as pendências externas por tabela.

**Limites da mudança:** somente Markdown. Sem novos builds manuais, release, deploy de Workers/Firebase, alteração Android/Gradle, exclusão de arquivos ou modificação de backups.
