# ATENÇÃO — PROPOSTA ANTIDENÚNCIAS REPETIDAS (RASCUNHO)

**Não publique estas regras no Firebase agora.** A versão release 0.18.0 (versionCode 24), instalada nos aparelhos, usa IDs aleatórios. As novas regras negariam suas denúncias!

## Como funciona
- O Android 0.18.1 (versionCode 25) usa uma identificação fixa por usuário e alvo: `uid_post_postId` ou `uid_reply_postId_replyId`.
- O Firestore exige o mesmo ID e proíbe sobrescrever denúncias existentes. Contas diferentes ainda podem denunciar o mesmo alvo.
- Os testes da PR usam apenas Firebase Emulator, nunca dados da produção.

## Publicação segura — SOMENTE APÓS AUTORIZAÇÃO EXPLÍCITA
1. Manter a PR em rascunho até todos os testes aprovarem.
2. Revisar compatibilidade e dar atenção a versões antigas do aplicativo. Não integrar sem um plano de atualização.
3. Quando autorizado, integrar o código e distribuir APK release 0.18.1 assinado com a mesma chave, **ainda com regras antigas de produção**, e testar.
4. Confirmar que todos que precisam denunciar atualizaram o aplicativo; depois, salvar cópia atual das regras do Firebase, verificar diferenças e publicar as regras novas separadamente.
5. Fazer testes isolados e seguros de leitura/comportamento; não tocar em denúncias reais.

**Limites:** isso impede novas denúncias duplicadas para um alvo por conta, mas não soma denúncias por minuto/dia. Denúncias antigas com IDs aleatórios continuam existindo e não são deduplicadas retroativamente.

**Privacidade:** os IDs incluem UIDs e nomes de documentos; só admins continuam podendo ler denúncias. Não expor IDs em logs públicos.
