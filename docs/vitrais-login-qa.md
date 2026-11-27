# Vitrais litúrgicos no login — candidato QA

Referência: Vitrais_Liturgicos_Atrio_Catolico (1).pdf, páginas 1–5. PR #470.

## Estado
- M1: seis WebP verticais definitivos (941 × 1672; 2.237.994 bytes), incluídos no commit 16291feaa1d22ff40ce025e977ae1cee2172fe76. Identidade dos seis blobs Git conferida. Falta medir impacto no APK.
- M2: reutiliza LocalLiturgicalDay e calendário civil local. Quinta-feira Santa mantém a regra existente (Quaresma); sem mudança geral do calendário.
- M3: fundo local, decodificação em IO, recorte superior, scrim, cartão opaco. A reserva horizontal foi removida: se a arte estiver indisponível, exibe somente fundo sólido. Cadastro e boas-vindas preservados. Somente QA Geral; desativação por LOGIN_VITRAIS_QA_ENABLED.
- M4: 28 verificações aprovadas, duas ignoradas, zero falhas no commit 16291fe. A suíte LoginLiturgicalBackdropUiTest foi aprovada no emulador (job 140246553305). O novo commit exige nova execução; teste adicional confirma presença, formato e dimensões das seis artes no APK. Avaliação do formulário real com fonte ampliada, teclado, contraste, paisagem, recuperação de senha e medição de desempenho ainda pendentes.
- M5: bloqueado até concluir critérios do PDF. Não publicar.

## Integridade
Diretório: app/src/main/assets/login-vitrais/. Da raiz:
`(cd app/src/main/assets/login-vitrais && sha256sum -c ../../../../../docs/vitrais-login.sha256)`

## Validação isolada
`ATRIO_QA_GERAL_BUILD=1 ./gradlew :app:testQaGeralUnitTest :app:assembleQaGeral`
Sem credenciais Firebase oficiais. Suíte instrumentada no grupo interaction do QA Android. A aprovação da compilação não equivale a validação física ou publicação.
