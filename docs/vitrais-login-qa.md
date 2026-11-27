# Vitrais litúrgicos no login — candidato QA

Referência: Vitrais_Liturgicos_Atrio_Catolico (1).pdf, páginas 1–5. PR #470.

## Estado
- M1: seis WebP verticais definitivos (941 × 1672; 2.237.994 bytes), incluídos no commit 16291feaa1d22ff40ce025e977ae1cee2172fe76. Identidade dos seis blobs Git conferida. Falta medir impacto no APK.
- M2: reutiliza LocalLiturgicalDay e calendário civil local. Quinta-feira Santa mantém a regra existente (Quaresma); sem mudança geral do calendário.
- M3: fundo local, decodificação em IO, recorte superior, scrim, cartão opaco. A reserva horizontal foi removida: se a arte estiver indisponível, exibe somente fundo sólido. Cadastro e boas-vindas preservados. Somente QA Geral; desativação por LOGIN_VITRAIS_QA_ENABLED.
- M4: 27 verificações aprovadas, duas ignoradas, zero falhas no commit ebafae54e0a9be2ee669d096c5fac739a9213783. Suíte LoginLiturgicalBackdropUiTest aprovada (job 140250331537), incluindo presença, formato e dimensões das seis artes, troca de tema e fallback sólido. Novo teste instrumentado do formulário real com escala de fonte 200%, área compacta, campos, senha visível/oculta, erro local de recuperação e navegação para cadastro; aguarda execução. Não envia pedidos de autenticação. Inspeção visual, teclado real, paisagem, recuperação completa e medições de desempenho continuam pendentes.
- M5: bloqueado até concluir critérios do PDF. Não publicar.

## Integridade
Diretório: app/src/main/assets/login-vitrais/. Da raiz:
`(cd app/src/main/assets/login-vitrais && sha256sum -c ../../../../../docs/vitrais-login.sha256)`

## Validação isolada
`ATRIO_QA_GERAL_BUILD=1 ./gradlew :app:testQaGeralUnitTest :app:assembleQaGeral`
Sem credenciais Firebase oficiais. Suíte instrumentada no grupo interaction do QA Android. A aprovação da compilação não equivale a validação física ou publicação.

## Medições de QA
- Commit 294340abfff010b3b062022610a2f1db66164f6b: 27 verificações aprovadas, duas ignoradas, nenhuma falha. Suíte de quatro testes de vitrais aprovada, inclusive formulário compacto a 200% (job 140255231625).
- O grupo interaction passa a coletar SHA-256 das seis artes dentro do APK, tamanho total, payload comprimido e três amostras de abertura de Activity após force-stop. Evidências em qa-android-suite-results/login-vitrais-metrics. Não confundir payload com diferença entre APKs ou primeira janela com login pronto. Resultados do novo commit pendentes.
- Ainda faltam comparação com uma build da base, inspeção visual/teclado real, paisagem e recuperação completa antes de liberação.

## Resultados do sexto commit (fe95fbf)
- 27 verificações aprovadas, duas ignoradas, nenhuma falha. Job interaction 140259025783 confirmou a suíte de vitrais e SHA-256 dos seis arquivos dentro do APK.
- APK QA Geral: 32.744.986 bytes. Artes: 2.237.994 bytes (6,83% do APK; não equivale ao delta entre builds).
- Abertura da Activity: 2.029, 1.955 e 1.940 ms; mediana 1.955 ms.
- Contraste analítico mínimo do texto branco sobre as seis artes com scrim 65%: 6,90:1; não substitui inspeção visual.
- Próximo commit adiciona comparação A/B com a base be1756ff036efdde1aa6529a6268dfe5951d77a3, na mesma variante e no mesmo emulador, três pares alternados. Relatório base-comparison.json. Aguardando resultados; nenhuma ativação em produção.
