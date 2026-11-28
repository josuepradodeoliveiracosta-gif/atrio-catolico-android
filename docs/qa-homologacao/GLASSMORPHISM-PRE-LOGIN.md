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
