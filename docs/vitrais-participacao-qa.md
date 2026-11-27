# Vitrais litúrgicos — participação (QA Geral)

Referência: Vitrais_Liturgicos_Participacao_Atrio_Catolico.pdf, 13 páginas; modelos p. 2–7, plano p. 8–13.
Base da main: 7cda7966bd84a0fe0b29680715e0609143438595. Referência física informada pelo proprietário: APK 49 instalado, candidato 82df9d8f581dd753885cc2bb071799e71cae737d; homologação comparativa não concluída.

## Marco 1 — mapa estático (27/11/2026)

- RegistrationV2.kt, RegistrationParticipationScreen: pergunta, cabeçalho RegistrationCompactHeader, três botões com onClick = onContinue, rolagem e alvos mínimos de 48 dp. Cabeçalho tem ação Voltar (atrio-auth-back) e emblema atrio_boas_vindas_vitral.
- OnlineAtrioApp.kt, OnlineAuthScreen: WELCOME / Criar conta -> PARTICIPATION; LOGIN / Ainda não tenho conta -> PARTICIPATION no fluxo normal; QA isolado que inicia em LOGIN usa REGISTER diretamente.
- Sou católico(a) -> onContinue() -> REGISTER; sem argumento.
- Quero conhecer melhor a fé católica -> onContinue() -> REGISTER; sem argumento.
- Nenhuma das opções se aplica a mim -> onContinue() -> REGISTER; sem argumento.
- REGISTER -> PARTICIPATION ao voltar no fluxo normal; PARTICIPATION -> WELCOME via seta ou BackHandler. goBack limpa senha, confirmação e estados de consentimento/erro; não guarda escolha religiosa. Não confundir esta tela com campos opcionais posteriores do cadastro. Não adicionar persistência, classificação nem envio de opção.
- Tema: LiturgicalTheme fornece LocalLiturgicalDay, derivado de LiturgicalCalendarBR.day com relógio civil local (ZonedDateTime.now), eventos de data/hora/fuso, nextChange e retomada de lifecycle. Consumir day.season como WelcomeVitralEntry, não day.red. Season.ATRIO/null e builds fora de qaGeral conservam visual padrão.
- Evidência estática somente. Capturas físicas de referência estreita, fontes, foco ao retornar e gesto real continuam pendentes. Não declarar marco funcional completo antes dessas provas.

## Marco 2 — fundação de paleta e recursos

ParticipationVitralPolicy reaproveita WelcomeVitralPolicy, com caminhos distintos e QA-only. Seis WebP planejados em app/src/qaGeral/assets/participacao-vitrais/ (participacao_vitral_advento, natal, tempo_comum, quaresma, triduo_pascal, pascoa). Nenhum recurso foi criado ou ativado ainda. Paletas da galeria coincidem com as cores base existentes. Região de leitura marfim e foco/pressão herdados; divisor e contraste sobre a arte final a validar. Testes JVM novos de associação, fallback, igualdade da paleta e contraste sólido; resultados pendentes.
Produzir molduras limpas sem textos, botões, emblema, seta ou barras de sistema. Emblema permanece componente próprio. Proposta técnica: WebP 790×1800 para compatibilidade com o decodificador existente, sujeita a revisão visual. Não usar capturas do PDF como recursos de produção.

## Próximos marcos / critérios de bloqueio

1. Aprovar seis artes e paletas, registrar dimensões, peso, SHA-256 e recortes.
2. Integrar carregamento local assíncrono de uma arte; aplicar paleta e bitmap juntos, fallback íntegro, atualizar ao retomar, cancelar resultados obsoletos. Preservar callbacks e ordem das escolhas. Não modificar as boas-vindas sem necessidade.
3. Composição acessível com seta, emblema/nome, divisor, pergunta e três escolhas equivalentes. Fonte ampliada, telas baixas, 48 dp, foco, TalkBack, toques repetidos e retorno.
4. QA 18 combinações tema × escolha, retorno, calendário antes/no instante/depois, offline, falhas, recuperação, concorrência, contraste e desempenho comparado no mesmo aparelho. Limites de desempenho a definir antes das medições.
5. Liberação acompanhada, versão candidata distinta do APK 49, teste de atualização/instalação nova e reversão. Não integrar nem assinar sem gates aprovados. Produção e APK 49 preservados.

## Marco 3 — integração em revisão (27/11/2026)

RegistrationParticipationScreen passa a chamar ParticipationVitralEntry. Fora do QA Geral mantém a implementação anterior sem acessar artes. No QA, a tela preserva callbacks sem argumentos, scroll e três ações; usa o mesmo LocalLiturgicalDay e o decodificador local existente, com caminhos de participação. Estado por tema/dimensões cancela publicação obsoleta; somente frame válido ativa a paleta. O fallback preserva controles, inclusive durante a troca; retomar após pausa reexecuta tentativa se frame ausente. Trava de navegação por visita evita toques repetidos; retorno/reentrada recria estado. Moldura decorativa sem descrição, área de leitura opaca, recorte superior em tela curta. Testes sintéticos de 18 interações, ausência de arte, isolamento de variante e concorrência adicionados ao grupo interaction. Não são prova da navegação real nem das artes finais.

Pendência bloqueante: as seis molduras limpas ainda não foram produzidas nem aprovadas. Sem elas a tela fica no fallback. Contraste com arte, TalkBack, desempenho físico, matriz real, captura visual e liberação permanecem pendentes. Não integrar antes de concluir esses gates.

## Marco 2 — exportacao das seis artes

Seis molduras novas sem controles rasterizados, WebP 790 x 1800, qualidade de compressao 87. Manifesto: docs/vitrais-participacao.sha256. Teste de recursos reais integrado a ParticipationVitralUiTest. Aprovacao visual, recortes, contraste sobre a arte e homologacao fisica continuam pendentes; nao liberar antes dos gates.

## Marco 4 — validação com recursos reais

No commit 09ea2077a9cd36c877d300673434c1c5ab493848, a suíte ParticipationVitralUiTest aprovou cinco testes, incluindo hashes e dimensões. A matriz completa ainda não estava aprovada: EmailVerificationAndroidUiTest.tresOpcoesDeParticipacaoAbremOCadastroEVoltamParaAEscolha não encontrou o título de login após voltar às boas-vindas. A causa ainda não está comprovada; não remover nem enfraquecer a asserção. Acrescentados testes de 36 escolhas com artes reais nos dois modos, 18 escolhas na navegação real isolada com datas fixas, 12 capturas de tela e diagnósticos de decodificação por tema. Aguardar resultados e revisar visualmente; TalkBack, offline explícito, recortes de tela curta com arte real e desempenho físico ainda pendentes. Medidas de decodificação em emulador não representam tempo de abertura ou memória total do app.

## Prevenção de regressão no retorno às boas-vindas

A suíte profiles do commit b54b3d73ff56f5b80df18c4352310170461e474a foi aprovada na nova rodada. A falha anterior não foi reproduzida nessa execução; a causa exata permanece indeterminada. A inspeção identificou que WelcomeVitralEntry descartava o frame ao sair da página, recriando temporariamente o visual padrão ao voltar. Foi introduzido um cache de um único frame válido, limitado à composição OnlineAuthScreen, com chave por contexto, paleta/arte, dimensões, tentativa e loader. Sem alteração de desenho, callbacks, recursos ou autenticação. Não guarda dados pessoais nem persiste em disco. Teste novo exige reutilização nas três reentradas, clique de login e invalidação ao mudar de estação; fallback original mantido em falta de arte. Aguardando CI, sem afirmar correção causal comprovada.

## Evidências e reforço de acessibilidade — 27/11/2026

O relatório do run 46067290251 (artefato 15232031355) confirma 8/8 testes da participação, 12 capturas e 6 diagnósticos. A suíte interaction foi cancelada depois destes testes, não equivale à aprovação de todo o workflow. Na revisão ab0e4c33541be333a20033b5627d1ee2a692f6e6, os 9 testes de boas-vindas e 8 de participação passaram e os 13 workflows aplicáveis terminaram com sucesso (2 ignorados). Capturas mostram títulos e três escolhas legíveis nos dois modos, com centro marfim preservado, porém alguns símbolos inferiores recortados. Decodificação em emulador: primeira 15,875–75,696 ms; mediana das repetições 15,481–57,434 ms; 5.688.000 bytes por bitmap. Não equivalem a memória total ou abertura física.

Ajuste agora proposto: encaixar a arte sem distorção na altura quando restarem pelo menos 300 dp de largura; nas telas curtas permitir rolar a composição inteira para acessar o rodapé ornamental. Critério de 300 dp é escolha técnica provisória, sujeita a captura e testes. Novas provas: seis temas reais em 320 × 440 dp com fontes 200%, alvos >= 48 dp, seis artes com rede efetivamente desconectada no AVD isolado (restaurada em finally), TalkBack em execução com foco na seta e nas três escolhas na estação Advento. Não equivale a leitura em voz validada nem homologação física. Aguardar CI e revisar novas capturas antes de concluir o marco. Nenhuma alteração nas regras Firebase, arte WebP, main ou versão.

## Correção de roteamento das suítes — 27/11/2026

No commit 15d587715f159049bb04b24ae4b8d585cf87b0ee, o workflow 46070086083 foi bloqueado antes da instrumentação: o contrato FOCAL_ROUTES não enumerava ParticipationVitralTalkBackUiTest, já executada no fluxo consent. Corrigida somente a lista esperada, mantendo as asserções de partição completa, disjunta e rota exclusiva. Conferência estática de chamadas e rota aprovada; CI pendente. O workflow 46070086159 falhou antes da compilação por HTTP 403 no repositório packages.microsoft.com (Ubuntu 26.04 resolute); nenhuma política de verificação de pacotes será relaxada. Nova execução necessária. Recortes corrigidos, offline e TalkBack ainda aguardam evidência.

## Correção de publicação do frame — 27/11/2026

No commit 82bde72049dfaf1eb25fef6394744cfb36077457, 12 workflows aprovados, 2 ignorados, 1 reprovado (46071067006). O relatório XML do artefato 15233560595 confirma ParticipationVitralUiTest 9/10, sem skips: offline real, 320 × 440 dp com fonte 200% e altura mínima 48 dp, navegação real e integridade aprovados. realAssetsKeepAllChoicesReachableInBothModes falhou em ViewRootImpl.requestLayout com CalledFromWrongThreadException, chamador DefaultDispatcher-worker-3; a pilha inclui o interceptor do recompositor de testes. As 12 capturas novas não foram geradas. O workflow 46071067017 de consentimento/TalkBack terminou aprovado. O teste de TalkBack verifica foco e serviço ativo, não a fala efetivamente ouvida. A hipótese de publicação do estado fora da thread Android durante a instrumentação será tratada explicitando Main.immediate ao redor da publicação, mantendo decode em IO e ensureActive antes de publicar. Não é prova de falha em produção, nem de correção definitiva. As dez asserções e a coleta obrigatória permanecem. Aguardar CI e inspeção visual antes de integrar.
