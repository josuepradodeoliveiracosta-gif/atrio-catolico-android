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
