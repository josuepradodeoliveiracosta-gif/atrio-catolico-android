# Átrio Católico 0.13.4 — Medalha do Moderador

## Identidade visual aprovada
- Medalhão circular, fundo azul-safira profundo.
- Escudo prateado em alto-relevo, com cruz dourada central.
- Moldura metálica dourada e ornamentos católicos.
- Ícone compacto de 27dp ao lado de **Moderador** nas publicações, respostas e perfil.

Recurso WEBP transparente de 256×256 pixels incorporado em `res/raw/selo_moderador_base64.txt`, no mesmo padrão já usado para Fundador, Padre e Diácono. A leitura do Base64 e a decodificação do bitmap são memorizadas pelo componente Compose, e um símbolo reserva aparece se a imagem não puder ser carregada.

## Segurança e compatibilidade
- Apenas perfis cujo documento `badges/{uid}` tenha `moderator=true`, atribuído por administrador confiável, exibem o selo Moderador.
- **O selo visual não concede poderes de moderação.** O acesso efetivo continua condicionado à lógica atual de `admins/{uid}` e às regras de segurança existentes.
- Não altera `firestore.rules`, Firebase Authentication, dados, documentos, credenciais nem a chave de assinatura.
- A medalha do Fundador, a do Padre e a do Diácono não foram substituídas.
- Versionamento: `versionCode=18`, `versionName=0.13.4`, aplicativo `br.com.atriocatolico`.

## Conferências recomendadas após a instalação
1. Verificar que o Moderador autorizado vê a medalha azul em perfil, publicações e respostas.
2. Verificar que um membro comum não consegue conceder a si mesmo o selo.
3. Confirmar que o selo não altera a capacidade de moderar para quem não é administrador.
4. Conferir que as medalhas Fundador, Padre e Diácono permanecem como antes.
