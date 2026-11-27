# Vitrais litúrgicos no login — candidato QA

Referência: Vitrais_Liturgicos_Atrio_Catolico (1).pdf, páginas 1–5. Base: be1756ff036efdde1aa6529a6268dfe5951d77a3.

## Estado
- M1 parcial: seis artes verticais WebP preparadas externamente (941 × 1672, 2.237.994 bytes no total); ainda não incluídas no Git. O QA utiliza provisoriamente as seis artes horizontais de boas-vindas já versionadas. Não são as artes do PDF.
- M2 em revisão: reutiliza LocalLiturgicalDay e o calendário civil local; testes de mapeamento e datas adicionados, ainda não executados. A Quinta-feira Santa segue o comportamento existente (Quaresma); uma mudança por horário litúrgico requer decisão e testes separados.
- M3 em revisão: fundo decorativo local, decodificação em IO, recorte superior, scrim, cartão opaco e fallback sólido. Fluxos de autenticação/cadastro preservados. Somente QA Geral; desativação pelo flag LOGIN_VITRAIS_QA_ENABLED.
- M4 pendente: compilar, executar testes, avaliar seis temas, tela pequena/paisagem, fonte ampliada, teclado, acessibilidade, offline, carga/falha, retorno após transição, login e recuperação de senha.
- M5 bloqueado: medir delta de APK e abertura, aprovar QA, revisar ativação e versionamento. Não liberar nem publicar.

## Artes definitivas
Copiar exclusivamente os seis WebP extraídos do PDF para app/src/main/assets/login-vitrais/:
login_vitral_advento.webp, login_vitral_natal.webp, login_vitral_tempo_comum.webp, login_vitral_quaresma.webp, login_vitral_triduo_pascal.webp, login_vitral_pascoa.webp.
Não modificar os recursos de boas-vindas. A prévia horizontal deve ser retirada ou substituída por fundo sólido antes da liberação se os recursos definitivos falharem.

## Validação local isolada
`ATRIO_QA_GERAL_BUILD=1 ./gradlew :app:testQaGeralUnitTest :app:assembleQaGeral` em checkout compatível com o gate do QA Geral. Não usar credenciais Firebase oficiais. Revisar resultado real do CI, não inferir homologação da presença dos testes.

## Evidência de integridade e QA
- Os SHA-256 dos seis WebP definitivos estão em `docs/vitrais-login.sha256`, medidos nos arquivos extraídos e otimizados. Antes de aprovar M1, executar da raiz do repositório: `(cd app/src/main/assets/login-vitrais && sha256sum -c ../../../../../docs/vitrais-login.sha256)`. Todos devem passar.
- O teste instrumentado `LoginLiturgicalBackdropUiTest` integra o grupo interaction do QA Android. Exercita a troca dos seis fundos locais e a permanência do fundo sólido sem imagem, sem depender de Firebase. A aprovação da prévia não comprova a presença das artes definitivas; verificar o manifesto separadamente.
- A revisão de acessibilidade do formulário real e as medições de abertura e tamanho do APK continuam pendentes.
