# Abertura em tela cheia — vídeo de inicialização

**Estado:** a proposta em revisão usa o vídeo `Atrio_Catolico_Tela_Cheia_9x16` como base da nova abertura. Preserva a regra anterior: vídeo obrigatório até a **primeira reprodução completa**, com **Pular** nos próximos lançamentos. Código em revisão não significa APK oficial publicado ou instalado.

## Comportamento previsto

- `MainActivity` exibe `AtrioStartupVideo` antes da autenticação ou da demonstração em **toda nova instância** do aplicativo, inclusive após processo encerrado e restaurado. Um `ViewModel` não persistido mantém a conclusão em alterações de configuração e retornos do segundo plano na mesma instância, mas é renovado após fechar e abrir o app.
- A apresentação ocupa a área toda e esconde temporariamente as barras de sistema. O vídeo preenche a tela com recorte central, sem esticar nem adicionar faixas. A montagem horizontal usa laterais desfocadas a partir do próprio vídeo para manter a marca no centro da tela.
- **Primeiro uso com dados locais novos:** o vídeo de cerca de 10 segundos é obrigatório e não existe botão **Pular**. Somente a conclusão natural do `MediaPlayer` grava `watched_to_end=true` em `SharedPreferences` locais (`atrio-startup-video`).
- **Próximos lançamentos:** o vídeo aparece novamente, agora com o botão acessível **Pular** no canto inferior direito. O usuário pode concluir o vídeo com áudio ou tocar em **Pular** para entrar diretamente.
- A tecla **Voltar** encerra a Activity sem liberar a comunidade (tanto na primeira quanto nas demais aberturas). Erro de decodificação ou timeout de 15 segundos permite continuar sem travar o app, **mas não registra o vídeo como concluído**; a próxima tentativa continua obrigatória até reprodução completa.
- Atualizar o app preserva a preferência. Limpar os dados ou reinstalar o aplicativo com backup desabilitado restaura a exigência. O estado da visualização não depende do Firebase ou da conta do usuário.
- Ao finalizar, restaura as barras de sistema e abre o fluxo já existente, sem mexer em autenticação, navegação, Firestore, avisos, Workers ou segurança.
- A antiga chamada após autenticação fica temporariamente com função de compatibilidade inerte; não há segundo vídeo após login.

## Histórico da primeira mídia (PR #116)

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


## Nova mídia

- Retrato: `app/src/main/res/raw/abertura_atrio.mp4`, 720 × 1280 (9:16), com a cruz, o terço e a transição para o céu do vídeo enviado.
- Paisagem: `app/src/main/res/raw-land/abertura_atrio.mp4`, 1024 × 576 (16:9), com a montagem horizontal da mesma animação. O Android seleciona o arquivo pela orientação.
- As duas versões são H.264/AAC de cerca de 10 segundos e usam a trilha fornecida, respeitando o volume de mídia do aparelho. A reprodução usa `TextureView` e arquivos do próprio APK, sem internet ou novas dependências.
- A abertura é exibida no fluxo normal de `MainActivity`. Variantes técnicas que abrem diretamente a tela de atualização ou o piloto isolado de perfil mantêm seus fluxos.

## Homologação da abertura e do áudio

- [x] APK QA Geral local compilado com as duas mídias. Os três testes unitários de enquadramento passaram; o teste `ProfileV3PolicyTest.optionalFieldsAndInterestsArePrivateByDefault` repetiu a falha registrada antes da alteração (152/153 na suíte).
- [x] MP4s decodificados e recortes inspecionados em retrato alto e paisagem larga. Isso não substitui o teste do player em Android.
- [ ] Em aparelho, verificar o preenchimento sem faixas em retrato e paisagem e confirmar que o logotipo e o título continuam visíveis.
- [x] APK dos testes instrumentados compilado; esses testes não foram executados em aparelho ou emulador.
- [ ] Em aparelho Android: iniciar sem internet, com volume de mídia audível, e conferir o vídeo completo (~10 segundos), com trilha sonora sincronizada e nenhuma tela de login à frente.
- [ ] Conferir ausência de som com volume de mídia no mínimo, controle de volume durante o vídeo e interrupção da trilha ao encerrar o aplicativo com Voltar.
- [ ] Limpar os dados do app **de testes** ou usar instalação limpa: confirmar ausência de **Pular** no primeiro acesso.
- [ ] Deixar o vídeo terminar naturalmente: confirmar entrada no fluxo normal e gravação da preferência local.
- [ ] Fechar/reabrir o app: conferir vídeo novamente, agora com o botão **Pular**, e validar que tocá-lo dá acesso imediato ao fluxo do aplicativo.
- [ ] Atualizar o mesmo pacote de testes preservando os dados: o botão **Pular** deve continuar disponível.
- [ ] Após limpar os dados/reinstalar: o botão **Pular** deve desaparecer até concluir a primeira reprodução completa.
- [ ] Antes de assistir até o fim, pressionar **Voltar**: sair do aplicativo, não registrar como assistido. Reabrir: ainda sem **Pular**.
- [ ] Fechar por Voltar ou remover a tarefa dos Recentes e abrir pelo ícone: reproduzir novamente em ambas as situações, mostrando **Pular** apenas se o vídeo já terminou naturalmente ao menos uma vez.
- [ ] Forçar parada ou matar o processo após ter assistido ao vídeo e abrir novamente, inclusive com estado de Activity restaurado: exibir a abertura outra vez, com **Pular** habilitado.
- [ ] Enviar o app ao segundo plano e voltar: não reiniciar.
- [ ] Após login/logoff, conferir que não aparece uma segunda abertura.
- [ ] Testar orientação diferente, texto ampliado, leitor de tela (nome **Pular** e área de toque acessível) e erro/corrupção do arquivo com fallback.
- [ ] Simular erro ou timeout no primeiro acesso: conferir que a navegação não trava e que **não** marca o vídeo como concluído; no próximo lançamento, a abertura permanece obrigatória.
- [ ] Testar modo demonstrativo e modo autenticado. CI aprovada não prova teste em aparelho.
- [ ] Após checks obrigatórios aprovados e revisão, integrar esta PR com a regra **primeira visualização obrigatória; depois opcional**. Distribuição oficial assinada fica em fluxo separado e autorizado.

**Não executado por esta tarefa:** publicação, geração de release, mudança de versão/assinatura, modificação de backend, backup, cron, regras Firebase ou Workers.
