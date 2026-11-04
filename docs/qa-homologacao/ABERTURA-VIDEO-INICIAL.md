# Abertura em tela cheia — vídeo de inicialização

**Estado:** código Android preparado em PR técnica; a **substituição do MP4 em binário é pendente**. Não confundir código pronto com vídeo novo incluído no APK ou APK instalado.

## Comportamento previsto

- `MainActivity` exibe `AtrioStartupVideo` antes da autenticação ou da demonstração, em todo **novo lançamento** da Activity (após fechar e reabrir). Não reaparece ao alternar para outro aplicativo e retornar à mesma instância.
- A apresentação ocupa a área toda, esconde temporariamente as barras de sistema e **preserva a proporção do vídeo** (sem cortar conteúdo). Em telas com outra proporção podem existir faixas na cor do fundo.
- Reproduz **uma vez**, sem som automático; conclui ao fim, após erro de leitura, pelo botão acessível **Pular**, pela tecla Voltar ou após 15 segundos de retomada ativa sem conclusão.
- Ao finalizar, restaura as barras de sistema e abre o fluxo já existente, sem mexer em autenticação, navegação, Firestore, avisos, Workers ou segurança.
- A antiga chamada após autenticação fica temporariamente com função de compatibilidade inerte; não há segundo vídeo após login.

## Arquivo exato fornecido nesta solicitação

| Dado | Valor |
| --- | --- |
| Destino no repositório | `app/src/main/res/raw/abertura_atrio.mp4` |
| Formato | MP4, H.264 + AAC |
| Resolução | 1080 × 1920 (9:16) |
| Duração | 10,026 s |
| Tamanho | 2.876.778 bytes |
| SHA-256 | `000ec24458026080c20e1f7f56441e9288a44b153176338797e1a316608d75f5` |
| Git blob SHA-1 calculado | `3d8fe939b612492014b35b2f5e727d4d128900c4` |
| Blob MP4 previamente presente na `main` | `005e8dbc2d9ddc25a11588891b2669ec756e3607` (3.378.959 bytes), **não é o arquivo enviado** |

**Pendente:** substituir esse arquivo binário **na branch da PR**, preservando o nome `abertura_atrio.mp4`, e conferir que a árvore Git exiba o blob `3d8fe939b612492014b35b2f5e727d4d128900c4`. O código usa `R.raw.abertura_atrio`, portanto a substituição não requer mudanças em Kotlin nem dependências de reprodução novas.

A integração disponível via ferramenta nesta conversa só autoriza escrita UTF-8 no repositório; por isso a mídia foi preparada separadamente como arquivo original e pacote com o caminho correto. Não foi realizado um upload binário não verificável, tampouco usado um servidor remoto como substituto oculto.

## Homologação antes da integração

- [ ] MP4 correto presente na branch e identificado pelo SHA de blob Git acima.
- [ ] Compilação Android de testes e verificações de segurança/versão/Firestore aprovadas no **head atualizado**.
- [ ] Em aparelho Android: iniciar sem internet e conferir o vídeo completo (10 segundos), som silenciado e nenhuma tela de login à frente.
- [ ] Tocar em **Pular** / botão Voltar e conferir transição sem travamento.
- [ ] Fechar o app e abrir pelo ícone: reproduzir outra vez.
- [ ] Enviar o app ao segundo plano e voltar: não reiniciar.
- [ ] Após login/logoff, conferir que não aparece uma segunda abertura.
- [ ] Testar orientação diferente, texto ampliado, leitor de tela e erro/corrupção do arquivo com fallback.
- [ ] Testar modo demonstrativo e modo autenticado. CI aprovada não prova teste em aparelho.
- [ ] Somente depois de aprovada, integrar a PR e criar APK com versionCode/assinatura preservados em fluxo separado e autorizado.

**Não executado por esta tarefa:** publicação, geração de release, mudança de versão/assinatura, modificação de backend, backup, cron, regras Firebase ou Workers.
