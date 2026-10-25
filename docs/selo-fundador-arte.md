# Selo Fundador — arte oficial no aplicativo

Esta atualização preserva a segurança por UID e apresenta o selo exclusivo com o nome curto **Fundador**.

## Arte aprovada e integrada

- Medalha circular com catedral dourada, fundo vinho profundo, louros dourados e moldura metálica.
- Arte gerada e aprovada nesta conversa; versão otimizada 192 × 192, WebP com transparência.
- Arquivo sob controle de versão em `app/src/main/res/raw/selo_fundador_base64.txt` (conteúdo codificado Base64 do WebP).
- O componente `FounderBadgeArt.kt` decodifica a imagem uma única vez por contexto e a exibe em `Image` Compose.
- A imagem acompanha o selo compacto em discussões, respostas e no perfil; na página de perfil do fundador há uma medalha maior.
- O pacote de PNGs em alta resolução desta conversa permanece disponível como arquivo-fonte de design, mas não é necessário ao funcionamento do APK.
- O texto curto da etiqueta é **Fundador**; o clique abre a descrição da identidade oficial.

## Segurança

- A identidade do fundador depende exclusivamente da igualdade entre `app_config/founder.uid` e o UID do usuário da publicação ou perfil.
- Nenhuma mudança na autenticação, em `firestore.rules`, em dados de usuários ou nas permissões reais de moderação.
- Os demais selos não sofrem alteração.

## Validação

1. Confirmar no CI a compilação Android e os testes do Firestore.
2. Instalar o release assinado da versão 0.13.1 sobre 0.13.0.
3. Validar a imagem no perfil oficial, discussões e respostas.
4. Confirmar que outras contas não exibem o selo e que o clique mostra a descrição.
5. Confirmar visualização em fundo claro, escuro e escala Android.
