# Issue #200 — caderno de deliberação para análise humana

**Estado: PROPOSTA DE REVISÃO / NÃO APROVADA / NO-GO.** Documento preparatório do Átrio Conversas (DMs e grupos) em `atrio-catolico-qa-geral`. Não é política vigente, parecer, prova de idade, autorização de QA ou produção, nem instrução para ligar `minorPolicyApproved`, `PUSH_ENABLED` ou qualquer serviço. Os registros oficiais da decisão permanecem **pendentes** no arquivo `ISSUE-200-REGISTRO-PENDENTE.json`.

## O que já está definido e não precisa ser votado novamente

- Idade mínima para conversas individuais e grupos: **18 anos completos**, decisão já registrada do fundador em **10/11/2026** (substituiu 16). Isso **não** define a idade de outras funcionalidades.
- O aniversário opcional informado no cadastro é triagem local, sem prova. Um documento Firestore de elegibilidade escrito por cliente, CPF digitado, foto enviada no chat ou autoafirmação **não** comprovam maioridade.
- Até existir um verificador confiável aprovado e registro mínimo emitido pelo servidor, negar chat para **todos**, inclusive quem declara ter 18 anos. Documentos de teste em emulador **não** devem ser emitidos no Firebase QA real.
- O Firebase QA real permanece fechado pelas regras deny-all até revisão e autorização específica. O Worker Cloudflare QA implantado é somente o bootstrap bloqueado.
- Regras e ensaios de emulador **não** equivalem a comprovação de política, papel de moderador real ou instalação QA em dois aparelhos.

## Pacote de decisões operacionais para discussão

As alternativas abaixo são **propostas técnicas para avaliação**, nunca opções aprovadas. Para cada uma, registrar escolha, justificativa, responsável, data, evidências verificadas e riscos residuais em ata sob revisão jurídica/privacidade. Não definir SLAs, prazos de guarda ou métodos de coleta por conveniência.

| Chave do registro | Proposta prudente para revisão humana | Falta aprovar/comprovar |
| --- | --- | --- |
| `trustedAgeProof` | Verificação 18+ por sinal externo autenticado e independente, com resposta **mínima**, UID/sessão, assinatura, expiração e revogação; indisponibilidade = chat bloqueado. | Seleção/diligência e contrato do fornecedor ou mecanismo, segurança/fraude, acessibilidade, privacidade, custos e testes reais; PR #228. |
| `contactConsentAndAbusePrevention` | Mensagens iniciais como **solicitação**, não abertura irrestrita; bloqueio bilateral, silenciamento, limites anti-spam proporcionais e procedimento de suspensão/recurso. | Configuração padrão de solicitações, limites numéricos e medidas específicas, revisão contra aliciamento e abuso. |
| `reportIntakeAndTriage` | Canal privado de denúncia com identificador de protocolo; triagem por gravidade e acesso apenas à evidência mínima submetida. | Responsáveis e substitutos, horário de operação, prazo de atendimento, comunicação ao denunciante e plano de contingência. |
| `moderatorAssignmentsAndAccess` | Acesso mínimo por papel com concessão/revogação auditada no backend; nenhum acesso geral ao histórico de DMs/grupos só por ser moderador. | Nomeação de quem pode conceder privilégios, IAM, auditoria, prazo de revisão de acesso; PR #221 é apenas emulador. |
| `appealsAndEmergencyEscalation` | Recurso com revisão humana distinta quando possível; categoria urgente com canal próprio e instruções de preservação sem investigação informal. | Responsável e substituto, gradação de risco, acionamento competente, prazos/recurso e ensaio de incidente; PR #224. |
| `formerMemberEvidence` | Manter acesso apenas ao protocolo próprio já registrado e oferecer rota controlada de denúncia **sem reabrir histórico privado** ao ex-integrante. | Desenho da rota, autenticação, preservação e testes de não ampliação de acesso de ex-membros. |
| `subjectRightsAndDeletion` | Solicitação autenticada de acesso, correção/eliminação/contestação; revisão de impedimentos legais antes de cada ação e trilha minimizada. | Identificação responsável, canal, prazos legais aplicáveis, recursos, execução e testes sem expurgo real; PR #225. |
| `retentionPolicyAndHolds` | Aprovar períodos, fundamentos e gatilhos **por cada classe** abaixo; preservar denúncia/recurso/ordem legal antes de qualquer descarte, inclusive cópias e subcoleções. | Parecer para as 13 classes, base/finalidade, expurgo e backup, responsáveis, simulação sem exclusão; PR #222. |
| `privacyLegalReview` | Revisão técnica e jurídica assinada, avaliação de riscos a menores inclusive acesso provável, mapa de tratamento, plano de incidentes e transparência ao usuário. | Revisor identificado e independente da autoria quando viável, data, versão, riscos residuais e evidência documental. |
| `qaRolloutAuthorization` | **Autorização específica e futura**, após parecer: exclusivamente Firebase QA, contas fictícias, janela e rollback, Rules/Worker fixados por SHA, IAM e monitoramento de custos. | Ato explícito de autorização, evidência de isolamento, testes end-to-end e auditoria pós-deploy. |
| `productionRolloutAuthorization` | Decisão inteiramente separada, somente após QA real concluído, revisão de privacidade, moderação operacional, dispositivos e plano de reversão. | Aprovação expressa posterior, não inferida de autorização QA ou PR verde. |

## Inventário de dados: treze decisões de guarda distintas

**Nenhum número de dias está aprovado.** Definir para cada linha: finalidade, base jurídica, momento inicial e final, prazo específico quando aplicável, acesso por papel, suspensão por denúncia/recurso/ordem competente, descarte de subcoleções/cópias e tratamento no backup. `Ocultar`/marcar `deletedForAll` não equivale a apagar dados físicos.

| Chave do registro | Uso ou tratamento a mapear | Questão para decisão |
| --- | --- | --- |
| `directMessages` | Textos, edições, marcador de remoção e referências a posts | Prazo, histórico após bloqueio, denúncia e exclusão de conta |
| `groupMessages` | Conteúdo de grupos ativos/encerrados | Histórico após saída/encerramento, pedidos de dados e preservação |
| `directReports` | Denúncia de DM e trecho enviado voluntariamente | Prazo por status, evidência necessária, recurso e hold |
| `groupReports` | Denúncia de grupo e evidência limitada | Ex-membros, acesso mínimo, prazo e hold |
| `groupInvites` | Convites, aceite, recusa e expiração | Limpeza após expiração sem apagar evidência de incidente |
| `hiddenMessages` | Preferências de ocultação por usuário | Eliminar configuração sem alegar exclusão do conteúdo original |
| `directMetadata` | Estado, membros, prévia e carimbo temporal de conversa | Minimização, histórico após conta encerrada e vínculos |
| `groupMetadata` | Nome, participantes, estado e controles | Encerramento e prova de participação/denúncia |
| `chatAgeEligibility` | Resultado mínimo 18+, versão e validade | Revogação, revisão, prazo do atestado e separação do fornecedor |
| `groupEligibility` | Revisão administrativa de acesso e expiração | Revogação, justificativas e trilha de auditoria |
| `chatPreferences` | Privacidade, silenciamento, bloqueios e caixas | Exclusão de preferências sem reabrir contato bloqueado |
| `auditTrails` | Eventos de segurança, moderação e deliberação | Minimização, acesso, base legal e prazo específico |
| `backups` | Cópias de todas as classes | Rotação, expurgo seguro verificável e exceções de preservação |

**Distinção legal que exige parecer:** o art. 15 do Marco Civil da Internet prevê, em condições específicas, retenção de **registros de acesso a aplicações** por seis meses para certas modalidades de provedor. Isso **não** significa que DMs, grupos, denúncias ou todos os backups devam ser guardados por seis meses. A aplicabilidade e a existência de logs desse tipo no Átrio precisam ser determinadas pelo jurídico antes de definir prazo ou alterar a lista de classes. Fonte: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm

## Risco de menores: não basta rotular o chat como 18+

A ANPD esclareceu em **28/10/2026** que um serviço declarado para adultos ainda pode se sujeitar ao ECA Digital se a análise de suas características mostrar **acesso provável por menores**. Uma verificação etária não afasta as demais obrigações de proteção. É necessário avaliar a comunidade além das DMs, facilidade de cadastro, convites, grupos, risco de aliciamento e configuração de privacidade. Não adotar como fato nem a inaplicabilidade nem a aplicabilidade integral ao Átrio antes de avaliação contextual.

Fontes oficiais para o parecer:
- Lei nº 15.211/2025, ECA Digital, vigente desde 17/03/2026: https://normas.leg.br/?urn=urn%3Alex%3Abr%3Afederal%3Alei%3A2025-09-17%3B15211
- ANPD, guia de escopo e obrigações gerais (28/10/2026): https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes
- ANPD, orientações de aferição de idade: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-orientacoes-preliminares-e-cronograma-para-afericao-de-idade-no-ambiente-digital
- ANPD, direitos do titular: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares

## Ordem objetiva até poder fechar a issue

1. **Responsável operacional:** escolher e justificar cada uma das onze decisões e preencher os treze prazos de forma individualizada (sem alterar diretamente o JSON protegido de minuta). Identificar responsável por moderação e por incidentes. Idade 18+ não precisa ser redeliberada.
2. **Revisão de privacidade/jurídica:** validar riscos a menores, bases e prazos, responsabilidade, evidências preservadas e tratamento dos direitos do titular. Registrar versão/data e pendências. Sem validação, manter NO-GO.
3. **Escolha do método 18+:** fazer diligência conforme PR #228, contratar/integrar somente após autorização própria e provar vinculação, revogação e falha fechada em testes. Nenhum CPF/documento/biometria no chat.
4. **Provas operacionais:** demonstrar, em cenário de QA autorizado, aferição etária end-to-end e triagem/moderação com papéis reais; observar proteção de ex-integrantes, incidentes e contestação. CI/emulador sozinho não supre esta etapa.
5. **Atos independentes:** registrar autorização **QA** para as Rules/Worker específicos com rollback, implantar apenas no projeto QA e auditar. Autorização **produção** é outra decisão, posterior ao conjunto do QA.
6. **Somente então revisar o fechamento #200:** anexar a ata, parecer, método/verificação, inventário e ensaio end-to-end; registrar riscos residuais e por que o bloqueio deixa de existir. Se houver qualquer lacuna, issue continua aberta e `minorPolicyApproved` não pode ser ligado.

## Modelo de ata a preencher manualmente (sem aprovações implícitas)

| Campo | Situação hoje |
| --- | --- |
| Responsável por política/moderação | **PENDENTE** |
| Responsável por privacidade/jurídico | **PENDENTE** |
| Escolha e contrato de verificação 18+ | **PENDENTE** |
| Onze decisões operacionais e suas justificativas | **PENDENTES** |
| Treze retenções com fundamento, prazo e hold | **PENDENTES** |
| Parecer, versão, data e riscos residuais | **PENDENTES** |
| QA: escopo, SHA, janela, rollback e autorização | **NÃO AUTORIZADO** |
| Produção: aprovação independente | **NÃO AUTORIZADA** |

**Resultado atual: NO-GO.** Documento e testes não atribuem cargo, não aprovam políticas, não alteram dados, não ativam chat, não excluem arquivos e não autorizam merge/deploy. QA permanece **2/7 marcos (29%)**.
