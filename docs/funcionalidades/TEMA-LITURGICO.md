# Tema litúrgico — Contemplação

## Calendário temático anual

O aplicativo calcula offline os tempos do rito romano brasileiro para cada ano civil. O Natal iniciado em dezembro continua em janeiro até o Batismo do Senhor. O ciclo litúrgico recomeça no primeiro domingo do Advento.

A Páscoa segue o cômputo gregoriano. O cálculo inclui as transferências brasileiras da Epifania e da Ascensão e a transferência da Anunciação quando coincide com a Semana Santa ou a Oitava da Páscoa. A aparência segue o calendário geral adotado nesta PR. A Quinta-feira Santa mantém a paleta quaresmal e a mudança para a paleta pascal ocorre à meia-noite local de domingo. As seis ilustrações continuam disponíveis offline.

## Inventário da integração

Antes: `AtrioTheme` oferecia apenas `lightColorScheme`, as cores vinho/papel eram fixas e o feed continha uma saudação estática. Agora as rotas mantêm a mesma árvore Compose. Nenhuma chave de navegação, consulta Firebase, permissão, assinatura ou identidade de pacote foi criada para o tema.

| Área | Integração | Verificação manual necessária |
|---|---|---|
| Abertura, entrada, cadastro, portões, menus e diálogos | Janela inicial clara/escura, papéis Material e feedback de erro próprio | Contraste das barras e teclado |
| Início, fóruns, busca, publicar e salvos | Banner de altura flexível, navegação, campos, seleções e cartões no esquema comum | Filtros, mídia, fonte ampliada e rolagem |
| Conversas e grupos | Cabeçalho, foco, balão de autoria e superfície neutra; sem reinicializar o compositor | Rascunho, seleção, teclado, foco TalkBack e envio |
| Perfil privado/público, insígnias e configurações | Aparência em Preferências e no menu. A cor dos símbolos de identidade não é substituída | Edição aberta e troca de conta |
| Notificações e administração | Filtros, cartões e diálogos; rótulo “Novo” além da cor | Estados lido/não lido e avisos administrativos |
| Demo, QA Geral, Perfil QA, Chat QA e OTA | Tema comum nas entradas Compose. Perfil QA expõe Aparência sem abrir a comunidade. Não se modificam superfícies externas do Android | Executar as variantes autorizadas, inclusive entrada restrita |

As preferências de boas-vindas são **por conta neste aparelho**, ativas por padrão, separadas da demonstração. O modo segue o sistema. O app agenda a próxima fronteira com a tela em primeiro plano e relê a hora e o fuso após retorno ou ajuste do relógio. A paleta muda sem animação. O desenho decorativo fica fora da ordem de leitura e o banner desativado deixa de existir na árvore.

## Homologação em aparelho (pendente)

Registrar SHA do build efetivamente instalado, variante, revisão do calendário, fuso, data/hora e capturas antes/depois. Conferir seis tempos × dois modos; fonte ampliada, alvos de toque, TalkBack e ícones do sistema. Em modo avião:

1. Digitar no chat às 23h59 de 27/03/2027 e mover o cursor. Às 00h00 conferir Páscoa, texto, seleção, foco e rolagem.
2. Passar para segundo plano e mudar de fuso atravessando a data. Conferir o tema imediatamente ao voltar.
3. Ocultar na conta A, mudar para B às 11h59, conferir “Boa tarde” sem trocar a paleta e voltar a A.
4. Abrir 01/01/2028 (Natal, continuidade entre anos), 06/05/2027 (pascal sem festa) e 09/05/2027 (Ascensão). Conferir recuperação no Início e em Aparência.

Comparar inicialização e renderização com a versão anterior no mesmo aparelho. Compilar o APK ou passar nos testes JVM não substitui esses ensaios.

## Evidência local — 20/11/2026

- Base local `4741a48dffb9` mais alterações não commitadas de `feature/tema-liturgico`. Comparada antes da edição à main `71ba0d669795`; nenhuma publicação.
- Compilação `:app:assembleQaGeral`: APK local `br.com.atriocatolico.qageral`, `0.19.10-qa-geral` (37), Gradle 8.13, Android 36. SHA-256 do APK: `1420b86e48d3943a13dfb191613f36af4b3b8ee75f18b9c6dbef0764bfcecd94`. Cópia e relatórios em `generated-artifacts/tema-liturgico/`, excluídos de Git e publicação.
- `:app:testQaGeralUnitTest`: 150 testes executados, 149 passaram. Os cinco testes de calendário e o teste de contraste de paletas passaram. Falhou `ProfileV3PolicyTest.optionalFieldsAndInterestsArePrivateByDefault` (linha 20); a política e esse teste não foram alterados nesta implementação.
- Testes de interface preparados, não executados. Sem capturas de aparelho real, validação TalkBack ou aprovação da edição pela CNBB.
