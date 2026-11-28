# Glassmorphism litúrgico pré-login — QA Geral

Base exata do APK 51: 07d69860f510a35e6e36cbcab29c9ab2fb74b7a7. Escopo: todos os painéis brancos opacos antes de autenticar; sem mudança de autenticação, consentimento, Firebase, artes ou produção.

## Inventário inicial
- WelcomeVitralEntry: Surface marfim opaca; botão Entrar também opaco. Aplicar token claro, borda e transparência.
- ParticipationVitralEntry: APK 51 já remove o cartão; preservá-lo sem recriar uma placa.
- OnlineAuthScreen: AuthPage LOGIN e REGISTER; login Card Paper opaco, cadastro já tem cartão escuro 86%. Recuperação de senha é ação inline no LOGIN, não uma página independente. Revisar mensagens, ícones, campos, estados de erro/foco/desabilitado e diálogos de termos/privacidade pré-cadastro.
- RegistrationOnboardingScreen: após criação da conta (UID autenticado); fora do escopo pré-login. Verificação de e-mail posterior à autenticação também não será alterada automaticamente.
- Fallback sem vitral e variantes fora de QA mantêm visual original.

## Etapas
1. Inventário e escopo: concluído.
2. Fundação: tokens claros/escuros, teste de contraste conservador, painel de boas-vindas translúcido (alpha 214/255) e botão secundário sem preenchimento opaco. Implementado, testes pendentes.
3. Vidro localizado: avaliar desfoque atrás da superfície, sem borrar controles nem toda a moldura. Usar caminho compatível, sem depender de RenderEffect em Android anterior a 31; evitar cópias de bitmaps e regressão de memória. Ainda não implementado.
4. Adaptar cartão login/recuperação, cadastro e diálogos legais, sem mudança de fluxo. Verificar contrastes reais e manter caixas de entrada reconhecíveis.
5. Testes focais: seis temas, claro/escuro, fonte grande, TalkBack/foco, teclado, offline, fallback, navegação e recuperação. Capturas reais, medição de custo de renderização e revisão. Não repetir suítes não afetadas.
6. Candidato APK posterior ao 51, assinatura protegida e homologação física; sem alteração da main até revisão.

Contraste teórico do título no pior fundo (preto) com a tinta clara 214/255: acima de 4,7:1; validar por teste e captura. Transparência sem blur não é glassmorphism completo; esta etapa entrega somente a base visual.

## Marco 3 — implementação do desfoque localizado

PreAuthGlassPanel desenha a região correspondente do bitmap existente em Canvas limitado ao painel, com RenderEffect via Modifier.blur de 12 dp (Android 12+ e View acelerada por hardware). A camada tem tratamento de borda retangular e é recortada pela Surface arredondada. Tinta, borda, texto e ações permanecem em camadas independentes. A imagem original externa não recebe efeito; não há nova decodificação nem cópia explícita de bitmap. Em Android 8–11 ou renderização por software, o Canvas adicional é omitido e permanece só a tinta translúcida. Suporta ContentScale e scrim parametrizados para os próximos painéis, mas a integração deste marco limita-se a WelcomeVitralEntry. Fonte, arte, navegação, fallback sem arte e participação do APK 51 preservados. Teste focal verifica pixels dentro/fora do painel, alternância para fallback e ações, além da suíte de boas-vindas com seis temas, 12 capturas, fonte ampliada e offline; teste JVM da política de contraste/capacidade. Resultados, inspeção das capturas e custo da camada GPU ainda pendentes. A intensidade atual é conservadora; ajuste visual após evidências.

## Marco 3 — evidências
Run 46091473493: 10/10 Android e 3/3 JVM, 18 capturas dos seis tempos revisadas. Desfoque restrito aprovado pelo teste de pixels; transparência discreta. Desempenho físico e TalkBack permanecem pendentes.

## Marco 4 — formulários
Login/recuperação e cadastro com vidro escuro 60% sobre scrim existente de 65%, com borda dourada e cores claras de texto, campos, estados e mensagens. Reutilização do único bitmap de cada formulário; posição da camada decorativa relativa à viewport acompanha scroll e IME. Publicação do bitmap na Main com cancelamento e fallback legado quando ausente. Sem alterar callbacks, validações, consentimentos ou serviços. Participação já não tem painel opaco: mantida. Diálogos legais ainda pendentes. Testes focais de login/cadastro, fonte 200%, erro local de recuperação, mudança de tema, offline e capturas. Sem envio de credenciais reais. Resultado pendente.

## Marco 5 — diálogos legais pré-login

Termos de Uso, Política de Privacidade e Regras da Comunidade usam PreAuthLegalDialog quando a arte do formulário está carregada. Tinta escura translúcida 214/255, borda dourada, textos claros e botão de fechamento de pelo menos 48 dp. AlertDialog nativo preservado, incluindo fechamento por voltar/toque externo e rolagem. Sem desfoque entre janelas ou captura do conteúdo de formulário: a transparência é suficiente, sem reprocessar possíveis credenciais. Sem alteração dos textos, links, consentimentos e callbacks; fallback legado intacto. Teste focal dos três links reais, abertura, capturas e fechamento sem aceitar consentimentos, mais fonte 200% e fallback; teste JVM de contraste do modal até sobre branco puro. Validação pendente; formulários anteriores ainda em execução ao preparar este marco.

## Marco 6 — evidências e limite de desempenho

Run 46092363198: 9/9 testes Android sem skips, três capturas de formulário. Run 46092771559: 2/2 testes Android e 1/1 JVM, três capturas dos diálogos. Inspeção das seis capturas confirmou legibilidade no Tempo Comum; as demais estações foram exercitadas funcionalmente, não fotografadas integralmente. Não afirmar homologação física nem envio real de e-mail. Limitar a camada opcional de blur a 2.500.000 pixels e 4096 px por lado; aparelhos low-RAM ou tamanho indisponível ficam com tinta translúcida e controles intactos. Limite de pixels não é medição de GPU ou memória total, e 2,5 milhões é decisão conservadora inicial. Mensagens do formulário com live region polite e recuperação com alvo mínimo de 48 dp; novo ensaio focal de foco TalkBack em login/cadastro e teste JVM dos limites. Sem repetir suites aprovadas. Leitura em voz, desempenho físico e resultados do novo ensaio pendentes.

## Refinamento visual após inspeção das boas-vindas

Run 46093695656 concluído com sucesso (foco TalkBack nos formulários e limite de camada JVM). O painel claro anterior (214/255) ainda parecia opaco. Reduzir somente a tinta clara para 166/255 (~65% opacidade, ~35% contribuição do fundo), mantendo o desfoque 12 dp e os limites de memória. Escurecer a cor de leitura sazonal por canal RGB a 60% do valor original, sem alterar o botão primário, as paletas compartilhadas da participação, o corpo de texto nem as artes. Cálculo conservador no fundo preto: menor contraste dos títulos 4,919:1; corpo 5,687:1. Revalidar somente a suíte de boas-vindas afetada (inclusive teste de pixels com o limite GPU ativo) e o teste JVM de contraste claro. Não repetir os formulários nem diálogos já aprovados. O candidato provisório 2a37d18 está desatualizado por este refinamento e não pode ser entregue. Nova inspeção visual e atualização do candidato antes da assinatura. Desempenho físico e fala do TalkBack ainda não medidos.

## V2 — correção solicitada após instalação do APK 52

Capturas físicas das boas-vindas e participação mostram que o vidro claro permanece visualmente quase branco, e a participação não recebeu vidro. Proprietário autorizou expressamente a variante escura de ambas. Tinta escura do login (153/255) sobre scrim preto local de 89/255 (aprox. 26% da arte original atravessa a composição), sem escurecer toda a tela. Títulos dourados claros, corpo marfim claro, contornos dourados e botões com as cores sazonais originais. Participação: painel somente na faixa central verificada, alinhamento e expansão responsiva preservados; o replay do blur usa a mesma projeção em três faixas da arte base. Sem alteração de assets, autenticação, login/cadastro/diálogos, callbacks ou fallback. Preservar limites GPU e alternativa sem blur. Testes focais: boas-vindas e participação, geometria, ação/retorno, fonte ampliada, seis temas, modos claro/escuro, offline, contraste e inspeção de pixels escuros para impedir retorno do painel branco. Próxima entrega requer novo versionCode 53, depois de testes e revisão de capturas. Nenhuma assinatura ou alteração de main autorizada neste marco.

## V3 — padronização pela referência física do cadastro (APK 53)

Proprietário autorizou unificar o acabamento conforme cadastro: a diferença vinha do scrim global de 65% no cadastro/login versus scrim local 35% nas entradas. Aplicar PreAuthStandardGlassPanel às quatro telas litúrgicas, com ART_SCRIM 166/255 sobre toda a arte, tinta 153/255, desfoque 12 dp, base #211922, título #FFE4AA, corpo #FFF5E6, borda #D9B97B 1 dp alpha .55, raio 20 dp, padding 16 dp e espaçamento 10 dp. Participação mantém faixa segura 72%, padding horizontal 12 dp para não sacrificar largura; vertical 16 dp, geometria responsiva, ornamentos intactos mas intencionalmente escurecidos. Botões sazonais das entradas e botões de formulário mantidos. Fallback sem arte e variantes externas preservados. Diálogos nativos mantêm alpha 214/255 e sem blur entre janelas por legibilidade e privacidade; reutilizam as cores comuns. Testar duas entradas, login/cadastro (componente compartilhado), contraste e pixels com limiar mais escuro. Artes originais e autenticação não alteradas. Capturas e homologação física pendentes.

## V3 — ajuste após primeira validação

Run 46100573122: boas-vindas 10/10, login/cadastro 9/9, participação 9/10. Reprovação no teste de proporção de pixels escuros (4016/7130), antes de gravar a primeira captura da participação; JVM não executado. 21 capturas disponíveis verificadas por CRC, cinco do Tempo Comum comparadas visualmente: fundos claros das entradas ainda induzem painel mais cinza. Compensar somente a luz que atravessa o vidro das entradas (camada preta local 166/255 sobre a arte já atenuada), com mesmos tokens de tinta, borda, raio e blur; sem alterar o cadastro de referência nem escurecer adicionalmente os ornamentos. A transmissão efetiva sob vidro cai de ~14% para ~5% nas entradas; fora do painel permanece 35%. Teste de pixels passa a amostrar as margens internas sem texto/botões, RGB máximo .20 e 95% das amostras, com captura anterior à asserção para diagnóstico. Validar contraste e as duas telas afetadas, sem repetir login/cadastro já aprovados. A equivalência perceptual final depende de nova inspeção física e de capturas; não liberar candidato numerado enquanto pendente.
