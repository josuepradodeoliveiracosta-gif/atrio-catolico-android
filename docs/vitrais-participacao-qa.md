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
