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
