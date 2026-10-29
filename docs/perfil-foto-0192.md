# Átrio Católico 0.19.2 — perfil, foto e segurança

## Auditoria da `main` (base `ec3aece9`)

- O perfil atual é lido de `profiles/{uid}` apenas pelo proprietário; as regras não permitem que membros consultem perfis alheios.
- O Firebase Authentication e o Firestore já estão integrados. **Firebase Storage/R2 e regras de avatar não estão configurados no aplicativo.**
- Discussões/respostas contêm `uid` e `authorName`; as regras de posts protegem esses campos contra falsificação. Os selos clericais são controlados pelo fluxo administrativo e não devem depender da foto.
- O perfil já dispõe de editor protegido contra descarte, selos, salvos, revisões, central de notificações e diagnóstico de push. Não duplicar funções.
- A lista antiga de publicações era apenas o recorte do feed; histórico completo e replies globais exigem consultas/índices adicionais.
- A cor vinho e a navegação continuam preservadas; o tema global não suporta dark mode de ponta a ponta. Alterar somente o Perfil não torna o restante escuro automaticamente.

## O que esta PR realmente implementa

1. Galeria Android via seletor do sistema (sem permissão geral de leitura), validação MIME JPG/PNG/WebP e limite de arquivo de 12 MB.
2. Decodificação com tamanho amostrado, recorte quadrado ajustável (zoom, posições horizontal/vertical), JPEG 400×400 com compressão e limite de 180 KB.
3. Salvar/remover foto **somente no armazenamento privado do aplicativo**, identificada pelo hash SHA-256 do UID.
4. Mostrar a foto no próprio Perfil e **nas próprias** discussões/respostas visualizadas no mesmo aparelho; pessoas sem foto ou outros usuários continuam com iniciais.
5. Evitar que uma foto seja exibida após a troca de conta; validar isolamento por UID no emulador.
6. Versão **Debug 0.19.2** (`versionCode 29`), mantendo o **release 0.19.0** (`versionCode 27`).
7. Testes de armazenamento e UI, incluindo capturas de telas reais do emulador com **foto sintética**, não foto de pessoa real.

## Não implementar sem aprovação adicional

A foto **não é compartilhada em outros aparelhos**. Isso é intencional: a regra atual `profiles/{uid}` é privada, não há bucket de fotos com regras auditadas e nenhum serviço novo foi autorizado.

Para oferecer upload e visualização pública no futuro, a alternativa preferida é um bucket Firebase Storage ou Cloudflare R2 com servidor autenticado:

- Caminho por UID, por exemplo `public_avatars/{uid}/avatar.jpg`, com leitura autenticada, gravação exclusiva do dono e **listagem negada**.
- Verificação de autenticação e regras do lado do servidor, com tamanho máximo de 180 KB e MIME `image/jpeg`. Bloquear SVG/HTML, nomes arbitrários e alterações em outros UIDs.
- Nunca guardar ou expor token de acesso, credencial de serviço ou chaves de Storage no APK.
- Usar cache de imagens limitado por UID e invalidação ao trocar foto ou conta, sem pedir imagem a cada recomposição.
- Tratar rollback quando upload funcionar mas a gravação de metadados falhar; testar upload, leitura, substituição e exclusão no emulador de Storage.
- Avaliar custos/cota e regras antes de habilitar qualquer upload real; publicação das regras exige autorização específica.

Nenhuma regra do Firestore, recurso Cloudflare ou configuração de produção foi alterada nesta PR.

## Validação e pendências

- Testar o sistema de arquivos privado com dois UIDs isolados, recorte e remoção.
- Confirmar que as capturas de tela e a navegação permanecem acessíveis com a fonte ampliada.
- Rodar compilação Android Debug, testes de segurança do Firestore no emulador, testes dos três bots e verificar versão do APK.
- Validar manualmente no celular antes de qualquer integração à `main`.
- **Nunca compilar release assinado nem alterar o backup sem autorização explícita.**
