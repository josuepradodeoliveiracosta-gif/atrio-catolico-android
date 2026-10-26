# Átrio Católico 0.15.0 — Perfil

- Cabeçalho com inicial do nome, nome centralizado, artes atuais dos selos e apresentação. A arte do Fundador foi preservada.
- Editar perfil reúne nome (2–35 caracteres após trim) e apresentação opcional (até 180) numa única atualização atômica do documento privado. Mostra contadores, progresso, erro e confirmação; só fecha após sucesso.
- Meus selos abre Gerenciar selos com retorno pelo botão e pelo gesto Voltar. Solicitar verificação abre escolha de Padre/Diácono antes do envio. Reutiliza as mesmas regras e coleções.
- Publicações vêm da lista paginada já existente. O perfil agora explica esse limite e oferece buscar mais; não apresenta a contagem parcial como total.
- Administração aparece somente aos administradores habilitados. E-mail, privacidade, versão e saída ficam ao final.
- applicationId e assinatura permanente preservados; versionCode 21, versionName 0.15.0. Nenhuma migração nem publicação de regras Firebase é necessária.

## Conferência no aparelho
1. Instalar o APK release sobre 0.14.0, sem desinstalar.
2. Conferir nome longo, apresentação vazia e preenchida e os selos existentes.
3. Abrir Editar perfil, cancelar sem alterar; testar nome de 1 caractere; salvar nome e apresentação válidos e conferir persistência ao reabrir o app.
4. Abrir Gerenciar selos, voltar por botão/gesto; conferir opções leigas e status do pedido. Cancelar a seleção clerical não deve enviar pedido.
5. Conferir navegação para publicação, comentários, outras abas e áreas administrativas autorizadas.
6. Conferir tela pequena, teclado aberto e fonte ampliada.

As verificações automáticas de CI não substituem esta conferência visual e de interação no dispositivo.
