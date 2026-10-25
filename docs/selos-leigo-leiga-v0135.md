# Selos Leigo e Leiga — Átrio Católico 0.13.5

## Aparência
- **Leigo**: medalha azul-escuro e dourada, cruz e Bíblia aberta, ramos ornamentais.
- **Leiga**: medalha vinho e dourada, cruz, Bíblia aberta, lírios brancos.
- A origem é a arte dupla aprovada na conversa; os dois recortes foram otimizados em WEBP de 72 × 72, codificados em Base64 e versionados em `res/raw`. A prévia PNG de maior resolução permanece disponível separadamente.
- A apresentação utiliza o mesmo componente de etiquetas do aplicativo e inclui uma medalha de 27dp seguida do nome.

## Identidade e segurança
- Leigo e Leiga são **autodeclarações opcionais** existentes em `badges/{uid}.lay`. O titular pode escolher Leigo, Leiga ou Nenhum.
- O aplicativo exibe apenas uma dessas duas opções por vez.
- A integração **não muda** `firestore.rules`, `admins`, `app_config/founder` ou qualquer concessão de cargos.
- Os selos de Fundador, Padre, Diácono e Moderador mantêm suas artes e condições de visibilidade.
- Selos de clero verificados têm preferência de exibição sobre a autodeclaração leiga.

## Verificações
1. Confirmar compilação Android com `R.raw.selo_leigo_base64` e `R.raw.selo_leiga_base64`.
2. Confirmar testes de segurança existentes.
3. No dispositivo, alternar **Leigo → Leiga → Nenhum** nas configurações de perfil e verificar as etiquetas em publicações e respostas.
4. Garantir que o selo Moderador só é exibido por atribuição administrativa e nenhuma seleção Leigo/Leiga concede privilégios.
5. Instalar release assinado 0.13.5 por cima da versão 0.13.4, sem desinstalação.
