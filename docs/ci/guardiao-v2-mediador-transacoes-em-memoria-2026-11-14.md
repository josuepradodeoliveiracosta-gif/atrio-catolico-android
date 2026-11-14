# Guardião V2 — mediador de teste em memória (não é serviço de produção)

**14/11/2026.** Extensão verificável da arquitetura da PR #288. Não implanta serviço, não emite tokens, não cria ambiente QA real, não abre porta, não usa redes, não acessa Firestore, Cloudflare ou IAM. Não altera o workflow privilegiado do Guardião. Esta implementação existe **somente** para validar o comportamento de autorização e as transições sintéticas de estado.

## Fronteiras do protótipo

- O arquivo `scripts/guardian_v2_qa_broker_fixture.py` oferece `OfflineBrokerFixture` com identidades **fictícias injetadas exclusivamente pelo teste**, e um estado inteiramente residente na memória do processo Python. Nenhuma identidade é autenticada de verdade.
- A classe reutiliza `simulate_qa_intent` da PR #288 como contrato de autorização inicial. Somente as identidades fictícias `qa-fixture-triage` e `qa-fixture-activation` são aceitas. Qualquer tentativa de inventar papel, principal ou campos Firestore no corpo é negada.
- A ativação manual exige aprovação sintética, versão coincidente e política sem parada emergencial nem autorização de retenção. Os únicos campos efetivamente alterados no estado falso são `enabled`, `autonomous_write_enabled` e a versão sintética; não há caminho para alterar `emergency_stop`.
- Um pedido de triagem **não é uma operação `:commit`**. O fixture verifica novamente política habilitada, proprietário e versão da fonte sintética, ID de caso derivado de caminho sintético, inexistência de caso anterior e orçamento máximo. Só então gera caso + auditoria + aviso e incrementa o contador, em uma seção crítica Python com bloqueio por processo.
- O projeto aceito é apenas o identificador inventado `guardian-v2-qa-fixture`. O projeto `atrio-catolico` e qualquer outro projeto são recusados.
- Todas as saídas incluem `production_authorized: false`, inclusive saídas positivas. O estado é copiado defensivamente e não é exportado por API.

## Limites explícitos de segurança

Esse objeto **não é mediador real**: qualquer código Python no mesmo processo consegue inspecionar seus atributos; o teste não verifica JWT de ID, credenciais, condições WIF, IAM herdado, concorrência entre instâncias, persistência ou taxas do banco. O CAS, o orçamento e o lock são **simulações de um único processo**, não provas de transações Firestore ou de negações externas. Portanto o estágio 3 continua `NO_GO` para produção até testes negativos autenticados em QA.

A identidade real do chamador deverá ser determinada pelo serviço a partir de token autenticado, audiência, emissor, principal e condições WIF verificados independentemente do payload. O executor do GitHub não poderá manter permissões IAM diretas de escrita no banco. A lista de documentos permitidos precisará ser imposta pela implementação que detém as credenciais, não pelo código do chamador.

## Critérios desta PR

1. Aprovar 21 testes offline adversariais de orçamento, leitura, ativação, CAS, replay, origens sintéticas, identidade trocada, campos extras, proibição de delete, concorrência e cópias de estado.
2. Aprovar o CI existente, CodeQL, compilação Android e Firestore sem adicionar jobs privilegiados, tokens, segredos ou dependências.
3. Limitar o diff aos arquivos de protótipo/testes/docs e uma linha no check de segurança.
4. Não fazer merge, push direto na `main`, deploy, alteração IAM, custo ou teste de dados reais sem autorização própria.

Para o passo seguinte, será necessário aprovar projeto/banco de homologação, identidade(s) de serviço, desenho de custos e rollback antes de qualquer implementação conectada ao Google Cloud. Consulte a matriz de negação em `docs/ci/guardiao-v2-isolamento-privilegios-preflight-2026-11-14.md`.
