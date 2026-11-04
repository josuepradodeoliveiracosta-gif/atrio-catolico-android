# Abertura em tela cheia — vídeo de inicialização

**Estado:** código Android e MP4 exato **integrados à branch da PR #116**; ainda dependem de verificações obrigatórias, revisão e merge para integrar a `main`. Não confundir branch/CI com APK instalado ou publicado.

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

**Integridade confirmada na PR #116:** o blob da branch para `app/src/main/res/raw/abertura_atrio.mp4` agora é `3d8fe939b612492014b35b2f5e727d4d128900c4` — idêntico ao SHA-1 calculado do arquivo enviado. O código usa `R.raw.abertura_atrio`; reprodução offline, sem hospedagem remota e sem introduzir dependência nova.


## Homologação antes da integração

- [x] MP4 correto presente na branch e identificado pelo SHA de blob Git acima.
- [ ] Compilação Android de testes e verificações de segurança/versão/Firestore aprovadas no **head atualizado** (conferir após último commit documental).
- [ ] Em aparelho Android: iniciar sem internet e conferir o vídeo completo (10 segundos), som silenciado e nenhuma tela de login à frente.
- [ ] Tocar em **Pular** / botão Voltar e conferir transição sem travamento.
- [ ] Fechar o app e abrir pelo ícone: reproduzir outra vez.
- [ ] Enviar o app ao segundo plano e voltar: não reiniciar.
- [ ] Após login/logoff, conferir que não aparece uma segunda abertura.
- [ ] Testar orientação diferente, texto ampliado, leitor de tela e erro/corrupção do arquivo com fallback.
- [ ] Testar modo demonstrativo e modo autenticado. CI aprovada não prova teste em aparelho.
- [ ] Somente depois de aprovada, integrar a PR e criar APK com versionCode/assinatura preservados em fluxo separado e autorizado.

**Não executado por esta tarefa:** publicação, geração de release, mudança de versão/assinatura, modificação de backend, backup, cron, regras Firebase ou Workers.
