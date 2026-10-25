# Átrio Católico 0.13.2 — Medalha Padre

## Arte
A medalha aprovada para **Padre** é circular, com **cruz dourada ornamentada** sobre **vinho profundo**, raios luminosos e aro dourado. A imagem compacta foi preparada em WEBP 256×256 com transparência e incorporada em `app/src/main/res/raw/selo_padre_base64.txt`; a leitura é feita por `PriestBadgeArt.kt`.

## Exibição e concessão
- O nome do selo continua **Padre**.
- A medalha será exibida em perfil, publicações e respostas através de `MemberBadgeRow`.
- A medalha só aparece se o campo confiável `badges/{uid}.clergy` for exatamente `padre`.
- O pedido `badge_requests/{uid}` nunca concede o selo automaticamente. A verificação e a concessão permanecem sob controle de administração confiável (Console/Admin SDK).
- Os selos Fundador, Diácono, Moderador, Leigo e Leiga permanecem inalterados.
- As regras do Firestore, a autenticação, o banco de dados e a assinatura permanente permanecem inalterados.

## Atualização e validação
- `versionCode=16`, `versionName=0.13.2`; mantém `applicationId=br.com.atriocatolico`.
- Executar os testes de segurança do Firestore e compilação Android antes do merge.
- Em dispositivo real, testar perfil de Padre verificado, publicação, resposta e acesso com conta sem selo Padre.
- Distribuir somente APK release assinado com a chave permanente, instalado **por cima** da versão 0.13.1, sem desinstalação.
