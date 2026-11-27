# Vitrais litúrgicos — entrada de boas-vindas (QA Geral)

Referência: Vitrais_Liturgicos_Boas_Vindas_Atrio_Catolico.pdf, revisão 27/11/2026, 19 páginas.
Base main inspecionada: 932916e8df9894097009b7bc181618ffce12c73f.
Escopo: RegistrationWelcomeScreen em RegistrationV2.kt, anterior ao login e ao cadastro. Não é LiturgicalWelcome (banner autenticado). Não modificar AuthPage.WELCOME, PARTICIPATION, REGISTER ou LOGIN, Firebase, Loja, Conversas, pacote, certificado, backup protegido ou produção nesta etapa.

## Marco 1 — inventário e contrato (iniciado)

| Chave de Season | Página | Símbolo focal | Destaque | Referência ampliada |
|---|---:|---|---|---|
| ADVENT | 2 | Coroa de quatro velas | #54266E | 13 |
| CHRISTMAS | 3 | Sagrada Família sob a estrela | #214477 | 14 |
| ORDINARY | 4 | Videira com cachos de uva | #235438 | 15 |
| LENT | 5 | Coroa de espinhos no deserto | #62405F | 16 |
| TRIDUUM | 6 | Cruz sobre a colina | #7B2639 | 17 |
| EASTER | 7 | Túmulo vazio e lírios | #745014 | 18 |

Os seis JPEGs de referência extraídos das páginas ampliadas têm 790–791 × 1800 px. Contêm letras e controles rasterizados; não são artes limpas nem devem entrar no APK. Identificação SHA-256 dos bytes de referência, por página:
```
13 5990d6d0554bffa40f35631e780e514f739c821dc17ec37481185b010c16a66d
14 84df2b4d43b820b5a6b8f65d3013e234ae671c42964325d1ca676e2023208c88
15 4012265f09a56fece8a73261d1a2925b2227f42f7b46eb98ca68125bd830f146
16 3cc43dc685b7c986bb9ea9d579c2d81a4f0567e987b11ae239afa3da13237c47
17 3e67725d620ad80fcb780d50454771f9b4f2576b102048005aadac25b0bb4c6b
18 532a369a46c77423c4a600b417c0559dc8d171a64acb7bfb7cb0aa64671fbe15
```

Preparar seis WebP limpos em app/src/qaGeral/assets/boas-vindas-vitrais/, com os nomes de WelcomeVitralPolicy. Preservar arco único, zona clara central e bordas decorativas; não copiar botões, textos, barra do sistema ou duplicar atrio_boas_vindas_vitral. Validar proporções, alternativa para corte inadequado e inventário de SHA-256 das exportações finais.

Paleta provisória de função: título, botão primário, contorno/rótulo secundário e foco externo usam o destaque do PDF; rótulo primário/foco interno branco; corpo #31272A, superfície de leitura opaca #FFF9F1. Pressão: Advento #47205D, Natal #1C3965, Tempo Comum #1D472F, Quaresma #533650, Tríduo #682030, Páscoa #624411. Pares sólidos calculados: branco sobre primário 7,24:1 a 11,17:1; título sobre superfície 6,92:1 a 10,68:1. Não são medições sobre o fundo real. Validar modo escuro, foco externo/interno, pressão, contraste real e 48 dp antes de integrar. A superfície clara é proposta de segurança, não aprovação estética.

## Marco 2 — resolução do tema (fundação iniciada)

Reutilizar LocalLiturgicalDay.current.season de LiturgicalTheme.kt e LiturgicalCalendarBR.REVISION (BR · calendário temático anual). Relógio civil do dispositivo, revisão ao entrar/retornar e transições existentes. Não usar day.red para substituir as seis artes. O calendário existente mantém Quinta-feira Santa em LENT, muda para TRIDUUM à meia-noite da Sexta-feira Santa e para EASTER à meia-noite do domingo; este trabalho não corrige nem altera o calendário geral. ATRIO, chave ausente, build não QA e falha de arte devem manter o visual padrão completo. WelcomeVitralPolicy define apenas associação e paletas; nenhuma integração de tela nesta PR. Testes de associação, fuso/fronteira, fallback e contraste sólido adicionados. Futuro loader dimensionado, cache por recurso/dimensões e cancelamento de cargas obsoletas; aplicar arte e paleta juntas, nunca cores sem arte válida.

## Marcos 3–5 — pendentes

- Interface: área segura, rolagem, símbolo único, textos e controles Compose, 48 dp, TalkBack, foco, pressão e navegação original (Criar conta → participação → cadastro; Entrar → login). Impedir empilhamento de destinos. Fallback padrão utilizável desde o primeiro frame.
- QA: 6 temas × 2 destinos, retorno, troca temporal, offline, arte ausente, fonte ampliada, proporções, contraste real. Evidência por cenário: SHA, aparelho, data/fuso, esperado, observado, captura. Medir abertura fria/quente, memória e tamanho com referência instalada e tolerâncias previamente acordadas.
- Entrega: depois de aprovar artes, testes e revisão, integrar por PR. O candidato físico seguinte deverá preservar o APK 48 e todas as suas alterações de QA, incluindo Conversas e Loja, com versionCode superior, mesmo applicationId e certificado QA. Não assinar/publicar até aprovação das barreiras existentes. Sem alteração de produção. Reversão pelo visual padrão completo ou nova versão corretiva com código maior.

Estado: inventário e contrato inicial implementados, exportações limpas e aprovação de arte pendentes. Sem alteração visual, sem compilação assinada ou homologação física. O percentual geral só avança por evidências; a aprovação de um plano não equivale à aprovação do aplicativo.

## Evidência de exportação — 27/11/2026

Seis recriações limpas dos modelos das páginas 13–18 geradas e inspecionadas visualmente, exportadas de PNG 831 × 1893 para WebP RGB 790 × 1800 (qualidade 85, Lanczos). Todos os seis arquivos foram decodificados com sucesso. Total 1.686.748 bytes. O pacote Vitrais_Boas_Vindas_Recursos_QA.zip inclui os seis WebP e o manifesto, SHA-256 2bf5ce971ced77648b7ef5ea79a7c74928ab375bfe42d1d7577c80dfb5a6b78c. Os hashes individuais estão em docs/vitrais-boas-vindas.sha256.

| Tema | Bytes | Menor contraste do destaque | Menor contraste do corpo |
|---|---:|---:|---:|
| Advento | 288510 | 6,86:1 | 8,87:1 |
| Natal | 352802 | 5,60:1 | 8,31:1 |
| Tempo Comum | 260162 | 5,15:1 | 8,49:1 |
| Quaresma | 232126 | 5,12:1 | 8,51:1 |
| Tríduo Pascal | 306806 | 4,15:1 | 6,22:1 |
| Páscoa | 246342 | 5,65:1 | 11,26:1 |

Medição conservadora pixel a pixel, região central provisória x=[119,671), y=[630,1260), sobre o WebP decodificado. Não representa captura da interface final. O Tríduo não atinge 4,5:1 nessa região para o destaque; exigir superfície protetora de leitura, validar posição real, foco, estado pressionado, fonte ampliada e barras. A arte é uma recriação do modelo, não uma extração literal. Preservar um arco único: zona focal aproximadamente x 25–75%, y 3–32%; evitar cortar essa área. Reservar região de leitura e usar composição alternativa em telas incompatíveis. Aprovação final de arte e validação em aparelho continuam pendentes.

A exportação existe como pacote local; a transferência dos binários para a branch QA ainda precisa ser confirmada. Não integrar esta PR nem ativar a interface até os arquivos estarem no caminho QA, com os seis hashes verificados. Nenhum APK novo gerado.

## Marco 2 — carregador preparado

WelcomeVitralLoader decodifica apenas a arte selecionada, em Dispatchers.IO, com amostragem inteira por dimensões. Valida 790 × 1800 px antes da alocação, publica arte e paleta em um único frame, mantém nulo durante falha/carregamento e isola cargas obsoletas por chave Compose. Reusa estado na composição enquanto as chaves não mudam. Parâmetro retry preparado para atualização futura pelo ciclo de vida. Testes JVM de amostragem adicionados; testes de troca rápida, falha e retomada ainda pendentes. Nenhuma ligação à RegistrationWelcomeScreen nesta etapa; transferência das seis artes permanece pré-requisito. Não ativar nem integrar a PR até verificação binária, CI e revisão.

## Marco 3 — interface candidata

Transferência confirmada em eeb79023d5cdc41d3a97c1e98273e17a9e5f5bf9: seis blobs com SHA-1 Git correspondentes aos seis WebP do pacote original, cujos SHA-256 foram conferidos. RegistrationWelcomeScreen delega à entrada temática; o visual anterior permanece íntegro para builds não QA, arte ausente e durante carregamento. Arte sem corte, proporção 790:1800, largura limitada a 440 dp, rolagem e insets na tela temática; conteúdo sobre painel de leitura opaco para contraste seguro, inclusive Tríduo. Decisão provisória de manter painel claro também no modo escuro, com entorno escuro. Botões Compose reais com 48 dp mínimos, cores de pressão e indicador de foco. Callbacks originais preservados; sem alteração de AuthPage, Firebase ou outras telas. Testes instrumentados novos verificam hashes/decodificação reais, seis temas e dois callbacks em fonte 2x, fallback de arte ausente. Não comprovam navegação autenticada, TalkBack, latência ou qualidade visual em aparelho; executar matriz e revisar composição antes de integrar. PR continua draft. Nenhuma compilação definitiva ou assinatura nesta etapa.
